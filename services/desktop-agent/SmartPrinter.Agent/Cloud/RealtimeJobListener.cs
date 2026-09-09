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
/// </summary>
public sealed class RealtimeJobListener : IAsyncDisposable
{
    private readonly SupabaseGateway _gateway;
    private readonly AgentOptions _options;
    private readonly ILogger<RealtimeJobListener> _logger;
    private RealtimeChannel? _channel;
    private CancellationTokenSource? _loopCts;
    private Func<CloudPrintJob, Task>? _onJobAssigned;

    public RealtimeJobListener(SupabaseGateway gateway, IOptions<AgentOptions> options, ILogger<RealtimeJobListener> logger)
    {
        _gateway = gateway;
        _options = options.Value;
        _logger = logger;
    }

    public async Task StartAsync(Guid deviceId, Func<CloudPrintJob, Task> onJobAssigned, CancellationToken cancellationToken)
    {
        _onJobAssigned = onJobAssigned;
        _loopCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

        // Always run one catch-up query immediately on start, before the socket is even
        // up, so jobs assigned while the agent was offline are never missed.
        await RunCatchUpAsync(deviceId, _loopCts.Token);

        _ = ConnectionLoopAsync(deviceId, _loopCts.Token);
    }

    private async Task ConnectionLoopAsync(Guid deviceId, CancellationToken cancellationToken)
    {
        var backoff = TimeSpan.FromSeconds(_options.RealtimeReconnectMinBackoffSeconds);
        var maxBackoff = TimeSpan.FromSeconds(_options.RealtimeReconnectMaxBackoffSeconds);

        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                var client = await _gateway.GetClientAsync();
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

                _channel.Subscribe();
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

                _logger.LogWarning("Realtime channel disconnected for device {DeviceId} - will reconnect", deviceId);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Realtime connection error - retrying in {Backoff}s", backoff.TotalSeconds);
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
        _loopCts?.Cancel();
        if (_channel != null)
        {
            try { _channel.Unsubscribe(); } catch { /* best effort on shutdown */ }
        }
    }
}
