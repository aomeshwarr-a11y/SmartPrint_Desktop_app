using System.Text.Json.Serialization;
using Postgrest.Attributes;
using Postgrest.Models;

namespace SmartPrinter.Agent.Cloud;

// These map to the tables defined in supabase/migrations/0001_init.sql. Column names use
// snake_case to match Postgres convention; Postgrest.Attributes.Column binds them to the
// PascalCase C# properties below.

[Table("print_jobs")]
public sealed class CloudPrintJob : BaseModel
{
    [PrimaryKey("id", false)]
    [Column("id")]
    public Guid Id { get; set; }

    [Column("device_id")]
    public Guid DeviceId { get; set; }

    [Column("printer_id")]
    public Guid PrinterId { get; set; }

    [Column("storage_path")]
    public string StoragePath { get; set; } = string.Empty;

    [Column("status")]
    public string Status { get; set; } = "queued";

    [Column("idempotency_key")]
    public string IdempotencyKey { get; set; } = string.Empty;

    [Column("print_options")]
    public string PrintOptionsJson { get; set; } = "{}";

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }
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

[Table("devices")]
public sealed class CloudDevice : BaseModel
{
    [PrimaryKey("id", false)]
    [Column("id")]
    public Guid Id { get; set; }

    [Column("shop_id")]
    public Guid ShopId { get; set; }

    [Column("name")]
    public string Name { get; set; } = string.Empty;

    [Column("status")]
    public string Status { get; set; } = "pending";

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

    [Column("device_id")]
    public Guid? DeviceId { get; set; }

    [Column("windows_printer_name")]
    public string WindowsPrinterName { get; set; } = string.Empty;

    [Column("driver_fingerprint")]
    public string? DriverFingerprint { get; set; }

    [Column("authorized")]
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
