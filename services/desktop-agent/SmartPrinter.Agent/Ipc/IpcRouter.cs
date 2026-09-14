using System.Text.Json;
using System.IO.Compression;
using Microsoft.Extensions.Logging;
using SmartPrinter.Agent.Cloud;
using SmartPrinter.Agent.Data;
using SmartPrinter.Agent.Data.Models;
using SmartPrinter.Agent.Printing;
using SmartPrinter.Agent.Printing.Models;
using System.Text.Json.Serialization;

namespace SmartPrinter.Agent.Ipc;

/// <summary>
/// Dispatches an incoming <see cref="IpcRequest"/> to the appropriate real service call.
/// Deliberately a plain switch over a closed set of commands (see <see cref="IpcCommands"/>)
/// rather than reflection-based method invocation, so every command the UI can trigger is
/// visible in one place for security review.
/// </summary>
public sealed class IpcRouter
{
    private readonly SqliteQueueRepository _queue;
    private readonly IPrinterService _printerService;
    private readonly DeviceAuthService _deviceAuth;
    private readonly JobProcessor _jobProcessor;
    private readonly RealtimeJobListener _realtimeListener;
    private readonly AgentRuntimeState _state;
    private readonly ILogger<IpcRouter> _logger;

    public IpcRouter(
        SqliteQueueRepository queue,
        IPrinterService printerService,
        DeviceAuthService deviceAuth,
        JobProcessor jobProcessor,
        RealtimeJobListener realtimeListener,
        AgentRuntimeState state,
        ILogger<IpcRouter> logger)
    {
        _queue = queue;
        _printerService = printerService;
        _deviceAuth = deviceAuth;
        _jobProcessor = jobProcessor;
        _realtimeListener = realtimeListener;
        _state = state;
        _logger = logger;
    }

    public async Task<IpcResponse> DispatchAsync(IpcRequest request, CancellationToken cancellationToken)
    {
        try
        {
            object? data = request.Command switch
            {
                IpcCommands.GetServiceStatus => await GetServiceStatusAsync(cancellationToken),
                IpcCommands.GetPrinters => await GetPrintersAsync(cancellationToken),
                IpcCommands.AuthorizePrinter => await AuthorizePrinterAsync(request, cancellationToken),
                IpcCommands.GetJobs => await GetRecentJobsAsync(cancellationToken),
                IpcCommands.GetJob => await GetJobAsync(request, cancellationToken),
                IpcCommands.GetQueue => await GetQueueAsync(cancellationToken),
                IpcCommands.GetSettings => await _queue.GetAllSettingsAsync(cancellationToken),
                IpcCommands.UpdateSettings => await UpdateSettingsAsync(request, cancellationToken),
                IpcCommands.PairDeviceCreate => await PairDeviceCreateAsync(request, cancellationToken),
                IpcCommands.PairDeviceConfirm => await PairDeviceConfirmAsync(request, cancellationToken),
                IpcCommands.UnpairDevice => await UnpairDeviceAsync(cancellationToken),
                IpcCommands.RestartService => RequestServiceRestart(),
                IpcCommands.GetLogs => GetRecentLogLines(),
                IpcCommands.ExportDiagnostics => await ExportDiagnosticsAsync(cancellationToken),
                IpcCommands.PrintTestPage => await PrintTestPageAsync(request, cancellationToken),
                _ => throw new InvalidOperationException($"Unknown IPC command '{request.Command}'.")
            };

            return IpcResponse.Ok(request.Id, data);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "IPC command {Command} failed", request.Command);
            return IpcResponse.Fail(request.Id, ex.Message);
        }
    }

    private async Task<ServiceStatusDto> GetServiceStatusAsync(CancellationToken cancellationToken)
    {
        var queued = await _queue.GetJobsByStatusAsync(new[] { LocalJobStatus.Queued, LocalJobStatus.Claimed, LocalJobStatus.Downloading, LocalJobStatus.Printing }, cancellationToken);
        return new ServiceStatusDto
        {
            IsPaired = _state.AgentId.HasValue,
            AgentId = _state.AgentId?.ToString(),
            BranchId = _state.BranchId?.ToString(),
            RealtimeConnected = _state.RealtimeConnected,
            MockCloudMode = _state.MockCloudMode,
            AgentVersion = typeof(IpcRouter).Assembly.GetName().Version?.ToString() ?? "0.0.0",
            QueuedJobCount = queued.Count
        };
    }

    private async Task<IReadOnlyList<PrinterInfo>> GetPrintersAsync(CancellationToken cancellationToken)
    {
        var printers = await _printerService.DiscoverPrintersAsync(cancellationToken);
        var cache = await _queue.GetCachedPrintersAsync(cancellationToken);
        var enriched = new List<PrinterInfo>(printers.Count);
        foreach (var p in printers)
        {
            var isAuth = cache.FirstOrDefault(c => string.Equals(c.PrinterName, p.Name, StringComparison.OrdinalIgnoreCase))?.IsAuthorized ?? false;
            await _queue.UpsertPrinterCacheAsync(new Data.Models.PrinterCacheRecord
            {
                PrinterName = p.Name,
                DriverName = p.DriverName,
                PortName = p.PortName,
                Fingerprint = p.Fingerprint,
                IsAuthorized = isAuth
            }, cancellationToken);

            enriched.Add(p with { IsAuthorized = isAuth });
        }
        return enriched;
    }

    private async Task<object> AuthorizePrinterAsync(IpcRequest request, CancellationToken cancellationToken)
    {
        var payload = Deserialize<AuthorizePrinterRequest>(request.Payload)
                      ?? throw new InvalidOperationException("Missing payload for AuthorizePrinter.");
        var printers = await _printerService.DiscoverPrintersAsync(cancellationToken);
        var match = printers.FirstOrDefault(p => p.Name == payload.PrinterName)
                    ?? throw new InvalidOperationException($"Printer '{payload.PrinterName}' was not found on this machine.");

        await _queue.UpsertPrinterCacheAsync(new Data.Models.PrinterCacheRecord
        {
            PrinterName = match.Name,
            DriverName = match.DriverName,
            PortName = match.PortName,
            Fingerprint = match.Fingerprint,
            IsAuthorized = payload.Authorized
        }, cancellationToken);

        return new { printerName = payload.PrinterName, authorized = payload.Authorized };
    }

    private Task<IReadOnlyList<PrintJobRecord>> GetRecentJobsAsync(CancellationToken cancellationToken) =>
        _queue.GetRecentJobsAsync(200, cancellationToken);

    private async Task<PrintJobRecord?> GetJobAsync(IpcRequest request, CancellationToken cancellationToken)
    {
        var id = request.Payload?.GetProperty("printJobId").GetString()
                 ?? throw new InvalidOperationException("Missing printJobId.");
        return await _queue.GetJobAsync(id, cancellationToken);
    }

    private Task<IReadOnlyList<PrintJobRecord>> GetQueueAsync(CancellationToken cancellationToken) =>
        _queue.GetJobsByStatusAsync(
            new[] { LocalJobStatus.Queued, LocalJobStatus.Claimed, LocalJobStatus.Downloading, LocalJobStatus.Downloaded, LocalJobStatus.Printing },
            cancellationToken);

    private async Task<object> UpdateSettingsAsync(IpcRequest request, CancellationToken cancellationToken)
    {
        var payload = Deserialize<UpdateSettingsRequest>(request.Payload)
                      ?? throw new InvalidOperationException("Missing payload for UpdateSettings.");
        foreach (var (key, value) in payload.Settings)
        {
            await _queue.SetSettingAsync(key, value, cancellationToken);
        }
        return await _queue.GetAllSettingsAsync(cancellationToken);
    }

    private async Task<object> PairDeviceCreateAsync(IpcRequest request, CancellationToken cancellationToken)
    {
        var ownerToken = request.Payload?.GetProperty("ownerAccessToken").GetString()
                         ?? throw new InvalidOperationException("Missing ownerAccessToken - the UI must be logged in first.");
        var result = await _deviceAuth.CreatePairingRequestAsync(ownerToken, cancellationToken);
        return new { pairingCode = result.PairingCode, expiresAt = result.ExpiresAtUtc };
    }

    private async Task<object> PairDeviceConfirmAsync(IpcRequest request, CancellationToken cancellationToken)
    {
        var payload = Deserialize<PairDeviceConfirmRequest>(request.Payload)
                      ?? throw new InvalidOperationException("Missing payload for PairDeviceConfirm.");
        var result = await _deviceAuth.ConfirmPairingAsync(payload.PairingCode, cancellationToken);
        _state.AgentId = Guid.Parse(result.AgentId);
        _state.BranchId = Guid.Parse(result.BranchId);
        return new
        {
            agentId = result.AgentId,
            branchId = result.BranchId,
            deviceId = result.AgentId,
            shopId = result.BranchId
        };
    }

    private async Task<object> UnpairDeviceAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("UnpairDevice requested via IPC - stopping Realtime and clearing state");

        // Stop Realtime FIRST, before clearing credentials, to prevent the reconnect
        // loop from continuing with stale state.
        if (_realtimeListener.IsRunning)
        {
            await _realtimeListener.StopAsync();
        }

        await _deviceAuth.UnpairAsync(cancellationToken);
        _state.AgentId = null;
        _state.BranchId = null;
        _state.RealtimeConnected = false;

        _logger.LogInformation("Desktop agent unpaired - Realtime stopped, credentials cleared, waiting for re-pairing");
        return new { unpaired = true };
    }

    private object RequestServiceRestart()
    {
        // A full service restart must go through the Service Control Manager (the process
        // cannot cleanly restart itself). We signal intent via device_state and exit 0;
        // the Windows Service Recovery policy (configured by the installer, see
        // installer/README.md) is set to "Restart the Service" on a clean exit as well as
        // on failure, so this results in an actual restart without extra IPC surface.
        _logger.LogInformation("Restart requested via IPC - exiting process for supervisor/SCM to restart");
        _ = Task.Run(async () =>
        {
            await Task.Delay(500);
            Environment.Exit(0);
        });
        return new { restarting = true };
    }

    private object GetRecentLogLines()
    {
        var logDir = Path.Combine(
            Environment.ExpandEnvironmentVariables("%PROGRAMDATA%\\SmartPrinter\\Agent"), "logs");
        if (!Directory.Exists(logDir)) return new { lines = Array.Empty<string>() };

        var latest = new DirectoryInfo(logDir).GetFiles("agent-*.log")
            .OrderByDescending(f => f.LastWriteTimeUtc)
            .FirstOrDefault();
        if (latest == null) return new { lines = Array.Empty<string>() };

        var lines = File.ReadLines(latest.FullName).TakeLast(500).ToArray();
        return new { file = latest.Name, lines };
    }

    private async Task<object> ExportDiagnosticsAsync(CancellationToken cancellationToken)
    {
        var exportDir = Path.Combine(Path.GetTempPath(), "SmartPrinterDiagnostics");
        Directory.CreateDirectory(exportDir);
        var bundlePath = Path.Combine(exportDir, $"diagnostics-{DateTime.UtcNow:yyyyMMdd-HHmmss}.zip");

        var logDir = Path.Combine(
            Environment.ExpandEnvironmentVariables("%PROGRAMDATA%\\SmartPrinter\\Agent"), "logs");

        var status = await GetServiceStatusAsync(cancellationToken);
        var printers = await GetPrintersAsync(cancellationToken);
        var recentJobs = await GetRecentJobsAsync(cancellationToken);

        var manifestPath = Path.Combine(exportDir, "manifest.json");
        await File.WriteAllTextAsync(manifestPath, JsonSerializer.Serialize(new
        {
            exportedAtUtc = DateTime.UtcNow,
            status,
            printers,
            recentJobs
        }, new JsonSerializerOptions { WriteIndented = true }), cancellationToken);

        if (File.Exists(bundlePath)) File.Delete(bundlePath);

        using (var zip = System.IO.Compression.ZipFile.Open(bundlePath, System.IO.Compression.ZipArchiveMode.Create))
        {
            zip.CreateEntryFromFile(manifestPath, "manifest.json");
            if (Directory.Exists(logDir))
            {
                foreach (var file in Directory.GetFiles(logDir, "agent-*.log").OrderByDescending(File.GetLastWriteTimeUtc).Take(5))
                {
                    zip.CreateEntryFromFile(file, Path.GetFileName(file));
                }
            }
        }

        return new { bundlePath };
    }

    private async Task<object> PrintTestPageAsync(IpcRequest request, CancellationToken cancellationToken)
    {
        var payload = Deserialize<PrintTestPageRequest>(request.Payload)
                      ?? throw new InvalidOperationException("Missing payload for PrintTestPage.");

        var testPdfPath = Path.Combine(Path.GetTempPath(), "smartprinter-test-page.pdf");
        await File.WriteAllBytesAsync(testPdfPath, TestPageGenerator.MinimalOnePagePdf(), cancellationToken);

        var outcome = await _printerService.SubmitDocumentAsync(
            payload.PrinterName, testPdfPath, new PrintOptions(), $"test-{Guid.NewGuid()}", cancellationToken);

        return new { status = outcome.Status.ToString(), error = outcome.ErrorMessage };
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    PropertyNameCaseInsensitive = true,
    Converters =
    {
        new JsonStringEnumConverter()
    }
};

private static T? Deserialize<T>(JsonElement? element) =>
    element.HasValue
        ? JsonSerializer.Deserialize<T>(
            element.Value.GetRawText(),
            JsonOptions)
        : default;
}
