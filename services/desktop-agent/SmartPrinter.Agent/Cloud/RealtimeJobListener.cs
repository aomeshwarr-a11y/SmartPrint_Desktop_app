using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SmartPrinter.Agent.Configuration;
using Supabase.Realtime;
using Supabase.Realtime.PostgresChanges;

namespace SmartPrinter.Agent.Cloud;

/// <summary>
/// Push-based job delivery (ARCHITECTURE.md §11): subscribes to a Postgres changefeed on
/// print_jobs filtered to this device's own id, so the agent sits idle until a row
/// actually changes instead of polling on an interval. This directly avoids the
/// Raspberry-Pi-era heartbeat cost problem noted in the blueprint.
///
/// Reliability additions on top of the raw Realtime subscription:
///   - Exponential backoff reconnect (min/max configurable in AgentOptions).
///   - A "catch-up" query on every (re)connect, in case a change happened while
///     disconnected and the socket never got the event.
///   - De-duplication at the SQLite layer (see SqliteQueueRepository.TryEnqueueJobAsync)
///     so a redelivered event can never cause a second physical print.
///
/// Lifecycle contract:
///   - StartAsync() begins exactly one connection loop for one device ID.
///   - StopAsync() cancels the loop, unsubscribes the channel, and resets state.
///   - A stopped listener will NOT reconnect. A new StartAsync() is required.
///   - Only one connection loop may be active at a time.
/// </summary>
public sealed class RealtimeJobListener : IAsyncDisposable
{
    private readonly SupabaseGateway _gateway;
    private readonly AgentOptions _options;
    private readonly ILogger<RealtimeJobListener> _logger;
    private RealtimeChannel? _channel;
    private CancellationTokenSource? _loopCts;
    private Func<CloudPrintJob, Task>? _onJobAssigned;
    private Guid? _activeDeviceId;
    private Task? _connectionLoopTask;

    public RealtimeJobListener(SupabaseGateway gateway, IOptions<AgentOptions> options, ILogger<RealtimeJobListener> logger)
    {
        _gateway = gateway;
        _options = options.Value;
        _logger = logger;
    }

    /// <summary>
    /// Whether a connection loop is currently active (started and not yet stopped/cancelled).
    /// </summary>
    public bool IsRunning => _connectionLoopTask != null && !_connectionLoopTask.IsCompleted;

    public async Task StartAsync(Guid deviceId, Func<CloudPrintJob, Task> onJobAssigned, CancellationToken cancellationToken)
    {
        // Guard: if a loop is already running for a different device, stop it first.
        if (IsRunning)
        {
            if (_activeDeviceId == deviceId)
            {
                _logger.LogWarning("Realtime listener is already running for device {DeviceId} - ignoring duplicate StartAsync", deviceId);
                return;
            }
            _logger.LogWarning("Stopping existing Realtime listener for device {OldDeviceId} before starting for {NewDeviceId}",
                _activeDeviceId, deviceId);
            await StopAsync();
        }

        _onJobAssigned = onJobAssigned;
        _activeDeviceId = deviceId;
        _loopCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

        _logger.LogInformation("Realtime listener starting for device {DeviceId}", deviceId);

        // Always run one catch-up query immediately on start, before the socket is even
        // up, so jobs assigned while the agent was offline are never missed.
        await RunCatchUpAsync(deviceId, _loopCts.Token);

        _connectionLoopTask = ConnectionLoopAsync(deviceId, _loopCts.Token);
    }

    /// <summary>
    /// Stops the Realtime connection loop, unsubscribes the channel, and resets internal state.
    /// After this call, no reconnect attempts will occur until StartAsync is called again.
    /// </summary>
    public async Task StopAsync()
    {
        var deviceId = _activeDeviceId;
        _logger.LogInformation("Realtime listener stopping for device {DeviceId}", deviceId);

        // Cancel the loop token first - this causes the ConnectionLoopAsync to exit.
        if (_loopCts != null)
        {
            await _loopCts.CancelAsync();
            _loopCts.Dispose();
            _loopCts = null;
        }

        // Unsubscribe the channel.
        UnsubscribeChannel();

        // Wait for the connection loop task to finish (it should exit quickly after cancellation).
        if (_connectionLoopTask != null)
        {
            try
            {
                await _connectionLoopTask.WaitAsync(TimeSpan.FromSeconds(5));
            }
            catch (TimeoutException)
            {
                _logger.LogWarning("Realtime connection loop did not exit within 5 seconds after cancellation");
            }
            catch (OperationCanceledException)
            {
                // Expected.
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Realtime connection loop exited with an error during shutdown");
            }
            _connectionLoopTask = null;
        }

        _activeDeviceId = null;
        _onJobAssigned = null;

        _logger.LogInformation("Realtime listener stopped for device {DeviceId}", deviceId);
    }

    private async Task ConnectionLoopAsync(Guid deviceId, CancellationToken cancellationToken)
    {
        var backoff = TimeSpan.FromSeconds(_options.RealtimeReconnectMinBackoffSeconds);
        var maxBackoff = TimeSpan.FromSeconds(_options.RealtimeReconnectMaxBackoffSeconds);

        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                // Validate that this device ID is still the active one (guards against stale loops).
                if (_activeDeviceId != deviceId)
                {
                    _logger.LogWarning("Realtime loop for device {DeviceId} detected device ID changed to {ActiveDeviceId} - exiting loop",
                        deviceId, _activeDeviceId);
                    break;
                }

                var client = await _gateway.GetClientAsync();

                // Dispose the previous channel before creating a new one.
                UnsubscribeChannel();

                _channel = client.Realtime.Channel($"print_jobs_device_{deviceId}");

                _channel.Register(
    new PostgresChangesOptions(
        "public",
        "print_jobs",
        PostgresChangesOptions.ListenType.Inserts,
        $"device_id=eq.{deviceId}"));

_channel.Register(
    new PostgresChangesOptions(
        "public",
        "print_jobs",
        PostgresChangesOptions.ListenType.Updates,
        $"device_id=eq.{deviceId}"));

_channel.AddPostgresChangeHandler(
    PostgresChangesOptions.ListenType.Inserts,
    async (_, change) =>
    {
        try
        {
            var job = change.Model<CloudPrintJob>();

            if (job != null &&
                string.Equals(job.Status, "queued", StringComparison.OrdinalIgnoreCase))
            {
                await _onJobAssigned!(job);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error handling Realtime INSERT print_jobs change event");
        }
    });

_channel.AddPostgresChangeHandler(
    PostgresChangesOptions.ListenType.Updates,
    async (_, change) =>
    {
        try
        {
            var job = change.Model<CloudPrintJob>();

            if (job != null &&
                string.Equals(job.Status, "queued", StringComparison.OrdinalIgnoreCase))
            {
                await _onJobAssigned!(job);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error handling Realtime UPDATE print_jobs change event");
        }
    });

                await _channel.Subscribe();
                _logger.LogInformation("Realtime subscription active for device {DeviceId}", deviceId);

                // Re-run catch-up immediately after (re)connecting, in case events were
                // missed during the gap between disconnect and this successful resubscribe.
                await RunCatchUpAsync(deviceId, cancellationToken);

                backoff = TimeSpan.FromSeconds(_options.RealtimeReconnectMinBackoffSeconds);

                // Wait until the channel disconnects (the SDK raises errors/closed state
                // internally); we poll the channel's own connection flag at a coarse
                // interval - this is NOT a job-polling loop, only a socket-health check.
                while (!cancellationToken.IsCancellationRequested && (_channel?.IsJoined ?? false))
                {
                    await Task.Delay(TimeSpan.FromSeconds(5), cancellationToken);
                }

                if (cancellationToken.IsCancellationRequested)
                {
                    _logger.LogInformation("Realtime loop cancelled for device {DeviceId} - stopping", deviceId);
                    break;
                }

                _logger.LogWarning("Realtime channel disconnected for device {DeviceId} - will reconnect in {Backoff}s", deviceId, backoff.TotalSeconds);
            }
            catch (OperationCanceledException)
            {
                _logger.LogInformation("Realtime loop cancelled for device {DeviceId} - stopping", deviceId);
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Realtime connection error for device {DeviceId} - retrying in {Backoff}s", deviceId, backoff.TotalSeconds);
            }

            // Check cancellation before sleeping for backoff.
            if (cancellationToken.IsCancellationRequested)
            {
                break;
            }

            try
            {
                await Task.Delay(backoff, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }

            backoff = TimeSpan.FromSeconds(Math.Min(backoff.TotalSeconds * 2, maxBackoff.TotalSeconds));
        }

        // Clean up channel on exit.
        UnsubscribeChannel();
    }

    private void UnsubscribeChannel()
    {
        if (_channel != null)
        {
            try { _channel.Unsubscribe(); } catch { /* best effort */ }
            _channel = null;
        }
    }

    private async Task RunCatchUpAsync(Guid deviceId, CancellationToken cancellationToken)
    {
        try
        {
            var missed = await _gateway.CatchUpQueuedJobsAsync(deviceId, cancellationToken);
            foreach (var job in missed)
            {
                await _onJobAssigned!(job);
            }
            if (missed.Count > 0)
            {
                _logger.LogInformation("Catch-up query picked up {Count} job(s) assigned while disconnected", missed.Count);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Catch-up query failed - will retry on next reconnect");
        }
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
    }
}
