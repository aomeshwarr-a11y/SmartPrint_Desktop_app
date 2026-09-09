using System.Text.Json.Serialization;

namespace SmartPrinter.Agent.Ipc;

/// <summary>
/// The full set of commands the Electron UI can invoke over the named pipe. Kept as a
/// closed set (not free-form strings dispatched via reflection) so the pipe surface is
/// easy to audit - see SECURITY.md "Named Pipe IPC".
/// </summary>
public static class IpcCommands
{
    public const string GetServiceStatus = "GetServiceStatus";
    public const string GetPrinters = "GetPrinters";
    public const string AuthorizePrinter = "AuthorizePrinter";
    public const string GetJobs = "GetJobs";
    public const string GetJob = "GetJob";
    public const string GetQueue = "GetQueue";
    public const string GetSettings = "GetSettings";
    public const string UpdateSettings = "UpdateSettings";
    public const string PairDeviceCreate = "PairDeviceCreate";
    public const string PairDeviceConfirm = "PairDeviceConfirm";
    public const string UnpairDevice = "UnpairDevice";
    public const string RestartService = "RestartService";
    public const string GetLogs = "GetLogs";
    public const string ExportDiagnostics = "ExportDiagnostics";
    public const string PrintTestPage = "PrintTestPage";
}

public sealed class IpcRequest
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("command")]
    public string Command { get; set; } = string.Empty;

    [JsonPropertyName("payload")]
    public System.Text.Json.JsonElement? Payload { get; set; }
}

public sealed class IpcResponse
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("data")]
    public object? Data { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }

    public static IpcResponse Ok(string id, object? data) => new() { Id = id, Success = true, Data = data };
    public static IpcResponse Fail(string id, string error) => new() { Id = id, Success = false, Error = error };
}

public sealed class ServiceStatusDto
{
    public bool IsPaired { get; set; }
    public string? DeviceId { get; set; }
    public bool RealtimeConnected { get; set; }
    public bool MockCloudMode { get; set; }
    public string AgentVersion { get; set; } = string.Empty;
    public int QueuedJobCount { get; set; }
}

public sealed class AuthorizePrinterRequest
{
    [JsonPropertyName("printerName")]
    public string PrinterName { get; set; } = string.Empty;

    [JsonPropertyName("authorized")]
    public bool Authorized { get; set; }
}

public sealed class UpdateSettingsRequest
{
    [JsonPropertyName("settings")]
    public Dictionary<string, string?> Settings { get; set; } = new();
}

public sealed class PairDeviceConfirmRequest
{
    [JsonPropertyName("pairingCode")]
    public string PairingCode { get; set; } = string.Empty;
}

public sealed class PrintTestPageRequest
{
    [JsonPropertyName("printerName")]
    public string PrinterName { get; set; } = string.Empty;
}
