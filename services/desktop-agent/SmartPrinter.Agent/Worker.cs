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
        var pipeTask = _pipeServer.RunAsync(stoppingToken);

        var credential = await _deviceAuth.LoadStoredCredentialAsync(stoppingToken);
        if (credential == null)
        {
            _logger.LogInformation("Agent is not paired with a shop yet - waiting for pairing via the desktop UI");
            await pipeTask; // Nothing else to do until PairDeviceConfirm arrives over IPC and the service is restarted.
            return;
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
            await pipeTask;
            return;
        }

        try
        {
            var accessToken = await _deviceAuth.RefreshAccessTokenAsync(stoppingToken);
            await _gateway.AttachDeviceSessionAsync(accessToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to obtain a device access token - Realtime job delivery will not start until this succeeds");
        }

        // Crash/restart recovery must run before we start accepting new jobs, so a job
        // left mid-flight by a previous crash is resolved first (see JobProcessor.RecoverAsync).
        await _jobProcessor.RecoverAsync(stoppingToken);

        await _realtimeListener.StartAsync(
            _state.DeviceId.Value,
            async job =>
            {
                _state.RealtimeConnected = true;
                var printerName = await ResolvePrinterWindowsNameAsync(job.PrinterId, stoppingToken);
                if (printerName == null)
                {
                    _logger.LogError("Received job for unknown/unauthorized printer id {PrinterId} - skipping", job.PrinterId);
                    return;
                }
                await _jobProcessor.HandleAssignedJobAsync(job, printerName, stoppingToken);
            },
            stoppingToken);

        var lastSeenTask = _lastSeenUpdater.RunAsync(_state.DeviceId.Value, stoppingToken);

        await Task.WhenAll(pipeTask, lastSeenTask);
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
