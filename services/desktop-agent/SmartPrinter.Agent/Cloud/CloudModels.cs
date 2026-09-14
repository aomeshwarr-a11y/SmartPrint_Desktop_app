using System.Text.Json.Serialization;
using Postgrest.Attributes;
using Postgrest.Models;

namespace SmartPrinter.Agent.Cloud;

[Table("print_jobs")]
public sealed class CloudPrintJob : BaseModel
{
    [PrimaryKey("id", false)]
    [Column("id")]
    public Guid Id { get; set; }

    [Column("printer_id")]
    public Guid PrinterId { get; set; }

    [Column("branch_id")]
    public Guid? BranchId { get; set; }

    [Column("file_path")]
    public string? FilePath { get; set; }

    [Column("status")]
    public string Status { get; set; } = "queued";

    [Column("razorpay_order_id")]
    public string? RazorpayOrderId { get; set; }

    [Column("copies")]
    public int Copies { get; set; } = 1;

    [Column("color")]
    public bool Color { get; set; }

    [Column("double_sided")]
    public bool DoubleSided { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    // Helpers / Accessors for agent processing pipeline
    private string? _storagePath;
    [JsonIgnore]
    public string StoragePath
    {
        get => _storagePath ?? FilePath ?? string.Empty;
        set
        {
            _storagePath = value;
            if (FilePath == null) FilePath = value;
        }
    }

    private string? _idempotencyKey;
    [JsonIgnore]
    public string IdempotencyKey
    {
        get => _idempotencyKey ?? RazorpayOrderId ?? Id.ToString();
        set
        {
            _idempotencyKey = value;
            if (RazorpayOrderId == null) RazorpayOrderId = value;
        }
    }

    private string? _printOptionsJson;
    [JsonIgnore]
    public string PrintOptionsJson
    {
        get => _printOptionsJson ?? System.Text.Json.JsonSerializer.Serialize(new CloudPrintOptions
        {
            Copies = Copies,
            Color = Color,
            Duplex = DoubleSided,
            PaperSize = 9
        });
        set => _printOptionsJson = value;
    }

    // Unmapped backwards-compatibility property
    [JsonIgnore]
    public Guid? DeviceId { get; set; }
}

[Table("print_job_events")]
public sealed class CloudPrintJobEvent : BaseModel
{
    [PrimaryKey("id", false)]
    [Column("id")]
    public Guid Id { get; set; }

    [Column("print_job_id")]
    public Guid PrintJobId { get; set; }

    [Column("event_type")]
    public string EventType { get; set; } = string.Empty;

    [Column("detail")]
    public string? DetailJson { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }
}

[Table("desktop_agents")]
public sealed class CloudDesktopAgent : BaseModel
{
    [PrimaryKey("id", false)]
    [Column("id")]
    public Guid Id { get; set; }

    [Column("branch_id")]
    public Guid BranchId { get; set; }

    [Column("agent_name")]
    public string AgentName { get; set; } = "Desktop Agent";

    [Column("hostname")]
    public string? Hostname { get; set; }

    [Column("os_version")]
    public string? OsVersion { get; set; }

    [Column("app_version")]
    public string? AppVersion { get; set; }

    [Column("status")]
    public string Status { get; set; } = "active";

    [Column("paired_at")]
    public DateTime PairedAt { get; set; }

    [Column("last_seen_at")]
    public DateTime? LastSeenAt { get; set; }

    [Column("revoked_at")]
    public DateTime? RevokedAt { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [Column("updated_at")]
    public DateTime UpdatedAt { get; set; }
}

// Backward-compatible alias for any code still referencing CloudDevice
[Table("desktop_agents")]
public sealed class CloudDevice : BaseModel
{
    [PrimaryKey("id", false)]
    [Column("id")]
    public Guid Id { get; set; }

    [Column("branch_id")]
    public Guid BranchId { get; set; }

    [Column("agent_name")]
    public string Name { get; set; } = string.Empty;

    [Column("status")]
    public string Status { get; set; } = "active";

    [Column("last_seen_at")]
    public DateTime? LastSeenAt { get; set; }
}

[Table("printers")]
public sealed class CloudPrinter : BaseModel
{
    [PrimaryKey("id", false)]
    [Column("id")]
    public Guid Id { get; set; }

    [Column("branch_id")]
    public Guid BranchId { get; set; }

    [Column("desktop_agent_id")]
    public Guid? DesktopAgentId { get; set; }

    // Backward-compatible accessor
    public Guid? DeviceId
    {
        get => DesktopAgentId;
        set => DesktopAgentId = value;
    }

    [Column("name")]
    public string WindowsPrinterName { get; set; } = string.Empty;

    [Column("driver_fingerprint")]
    public string? DriverFingerprint { get; set; }

    [Column("is_active")]
    public bool Authorized { get; set; }

    [Column("status")]
    public string Status { get; set; } = "unknown";
}

/// <summary>DTO used purely for JSON (de)serialization of print_options, not a DB table.</summary>
public sealed class CloudPrintOptions
{
    [JsonPropertyName("copies")]
    public int Copies { get; set; } = 1;

    [JsonPropertyName("color")]
    public bool Color { get; set; }

    [JsonPropertyName("duplex")]
    public bool Duplex { get; set; }

    [JsonPropertyName("paper_size")]
    public short PaperSize { get; set; } = 9;

    [JsonPropertyName("landscape")]
    public bool Landscape { get; set; }
}
