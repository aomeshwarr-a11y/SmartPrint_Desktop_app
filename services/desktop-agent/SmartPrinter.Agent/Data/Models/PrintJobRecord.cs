namespace SmartPrinter.Agent.Data.Models;

public static class LocalJobStatus
{
    public const string Queued = "queued";
    public const string Claimed = "claimed";
    public const string Downloading = "downloading";
    public const string Downloaded = "downloaded";
    public const string Printing = "printing";
    public const string Completed = "completed";
    public const string Failed = "failed";
    public const string Cancelled = "cancelled";

    /// <summary>Terminal states - a job in one of these will never transition again locally.</summary>
    public static readonly HashSet<string> Terminal = new(StringComparer.OrdinalIgnoreCase)
    {
        Completed, Failed, Cancelled
    };

    /// <summary>
    /// States where the process could have died mid-way and we cannot assume the outcome -
    /// these must be reconciled against the cloud on startup (see JobProcessor.RecoverAsync).
    /// </summary>
    public static readonly HashSet<string> RequiresRecoveryCheck = new(StringComparer.OrdinalIgnoreCase)
    {
        Claimed, Downloading, Downloaded, Printing
    };
}

public sealed class PrintJobRecord
{
    public required string PrintJobId { get; set; }
    public required string IdempotencyKey { get; set; }
    public required string PrinterId { get; set; }
    public string? PrinterName { get; set; }
    public required string StoragePath { get; set; }
    public required string Status { get; set; }
    public string OptionsJson { get; set; } = "{}";
    public string? LocalFilePath { get; set; }
    public int? SpoolerJobId { get; set; }
    public int RetryCount { get; set; }
    public string? LastError { get; set; }
    public DateTime? ClaimedAt { get; set; }
    public DateTime? DownloadedAt { get; set; }
    public DateTime? PrintedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class LocalJobEvent
{
    public int Id { get; set; }
    public required string PrintJobId { get; set; }
    public required string EventType { get; set; }
    public string? Detail { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class PrinterCacheRecord
{
    public required string PrinterName { get; set; }
    public string? DriverName { get; set; }
    public string? PortName { get; set; }
    public string? Fingerprint { get; set; }
    public bool IsAuthorized { get; set; }
    public string? RemotePrinterId { get; set; }
    public DateTime LastSeenAt { get; set; }
}
