using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SmartPrinter.Agent.Cloud;
using SmartPrinter.Agent.Configuration;
using SmartPrinter.Agent.HealthCheck;
using SmartPrinter.Agent.Ipc;

namespace SmartPrinter.Agent;

/// <summary>
/// The single hosted background service that IS the agent. Everything the shop PC needs
/// to keep doing - listening for the Electron UI on the named pipe, listening for jobs on
/// Supabase Realtime, recovering from a previous crash, and pinging last-seen - runs from
/// here for as long as the process is alive, independent of whether the UI window is open.
/// See ARCHITECTURE.md §3 for why this separation is the core reliability guarantee.
/// </summary>
public sealed class Worker : BackgroundService
{
    private readonly DeviceAuthService _deviceAuth;
    private readonly SupabaseGateway _gateway;
    private readonly RealtimeJobListener _realtimeListener;
    private readonly JobProcessor _jobProcessor;
    private readonly LastSeenUpdater _lastSeenUpdater;
    private readonly NamedPipeServer _pipeServer;
    private readonly AgentRuntimeState _state;
    private readonly AgentOptions _options;
    private readonly ILogger<Worker> _logger;

    public Worker(
        DeviceAuthService deviceAuth,
        SupabaseGateway gateway,
        RealtimeJobListener realtimeListener,
        JobProcessor jobProcessor,
        LastSeenUpdater lastSeenUpdater,
        NamedPipeServer pipeServer,
        AgentRuntimeState state,
        IOptions<AgentOptions> options,
        ILogger<Worker> logger)
    {
        _deviceAuth = deviceAuth;
        _gateway = gateway;
        _realtimeListener = realtimeListener;
        _jobProcessor = jobProcessor;
        _lastSeenUpdater = lastSeenUpdater;
        _pipeServer = pipeServer;
        _state = state;
        _options = options.Value;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("SmartPrinter Agent worker starting (MockCloudMode={Mock})", _options.MockCloudMode);

        // The named pipe server must come up immediately and unconditionally, regardless
        // of pairing/cloud state, so the Electron UI can always talk to the agent (to show
        // "not paired yet", offline banners, etc).
        _ = _pipeServer.RunAsync(stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            var credential = await _deviceAuth.LoadStoredCredentialAsync(stoppingToken);
            if (credential == null)
            {
                _logger.LogInformation("Agent is not paired with a shop yet - waiting for pairing via the desktop UI");
                _state.DeviceId = null;
                _state.ShopId = null;
                _state.RealtimeConnected = false;

                // Wait until PairDeviceConfirm completes over IPC
                await _deviceAuth.WaitForPairingAsync(stoppingToken);
                continue;
            }

            _state.DeviceId = Guid.Parse(credential.DeviceId);
            _state.ShopId = Guid.Parse(credential.ShopId);

            if (_options.MockCloudMode)
            {
                _logger.LogWarning(
                    "MockCloudMode is enabled - Supabase Realtime/job delivery is NOT active. " +
                    "Printer discovery and printing are real. Use the PrintTestPage IPC command " +
                    "or insert a row directly into print_jobs in SQLite to exercise the pipeline. " +
                    "See docs/DEVELOPMENT.md.");
                _state.MockCloudMode = true;
                await _deviceAuth.WaitForUnpairAsync(stoppingToken);
                continue;
            }

            // Authenticate with the backend - if this fails due to revocation, the device
            // must be treated as unpaired and Realtime must NOT start.
            string accessToken;
            try
            {
                accessToken = await _deviceAuth.RefreshAccessTokenAsync(stoppingToken);
                await _gateway.AttachDeviceSessionAsync(accessToken);
                _logger.LogInformation("Device authentication succeeded for device {DeviceId}", _state.DeviceId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to obtain a device access token - Realtime will NOT start");

                // If the credential was revoked, DeviceAuthService.RefreshAccessTokenAsync
                // already called UnpairAsync (clearing the credential store). Reflect that
                // in runtime state so the UI sees "unpaired" immediately.
                if (!_deviceAuth.IsPaired)
                {
                    _logger.LogWarning("Device credential was revoked - device is now unpaired. " +
                                       "Waiting for re-pairing via the desktop UI");
                    _state.DeviceId = null;
                    _state.ShopId = null;
                    _state.RealtimeConnected = false;
                }

                // Wait until re-pairing occurs via desktop UI
                await _deviceAuth.WaitForPairingAsync(stoppingToken);
                continue;
            }

            // Create a session cancellation token for the active pairing session.
            // When an unpair occurs, cancelling this session token stops the Realtime
            // listener and last-seen updater cleanly without stopping the entire Worker.
            using var sessionCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);

            // Crash/restart recovery must run before we start accepting new jobs
            await _jobProcessor.RecoverAsync(sessionCts.Token);

            var activeDeviceId = _state.DeviceId.Value;

            await _realtimeListener.StartAsync(
                activeDeviceId,
                async job =>
                {
                    _state.RealtimeConnected = true;
                    var printerName = await ResolvePrinterWindowsNameAsync(job.PrinterId, sessionCts.Token);
                    if (printerName == null)
                    {
                        _logger.LogError("Received job for unknown/unauthorized printer id {PrinterId} - skipping", job.PrinterId);
                        return;
                    }
                    await _jobProcessor.HandleAssignedJobAsync(job, printerName, sessionCts.Token);
                },
                sessionCts.Token);

            var lastSeenTask = _lastSeenUpdater.RunAsync(activeDeviceId, sessionCts.Token);

            // Wait until device is unpaired or stoppingToken is cancelled
            await _deviceAuth.WaitForUnpairAsync(sessionCts.Token);

            _logger.LogInformation("Device unpair event detected in worker - stopping active cloud session for device {DeviceId}", activeDeviceId);

            // Stop Realtime listener and cancel session tasks
            await _realtimeListener.StopAsync();
            sessionCts.Cancel();
            try { await lastSeenTask; } catch (OperationCanceledException) { }

            _state.DeviceId = null;
            _state.ShopId = null;
            _state.RealtimeConnected = false;
        }
    }

    private async Task<string?> ResolvePrinterWindowsNameAsync(Guid printerId, CancellationToken cancellationToken)
    {
        // In production this should resolve via a small cached lookup table synced from
        // the `printers` table (remote id -> windows_printer_name), populated whenever
        // AuthorizePrinter runs. For brevity here we re-derive it from the local printer
        // cache keyed by remote_printer_id, which IpcRouter.AuthorizePrinterAsync keeps
        // up to date whenever the owner authorizes a printer in the UI.
        var client = await _gateway.GetClientAsync();
        var response = await client.From<CloudPrinter>()
            .Where(p => p.Id == printerId)
            .Where(p => p.Authorized == true)
            .Get(cancellationToken);
        return response.Models.FirstOrDefault()?.WindowsPrinterName;
    }
}
