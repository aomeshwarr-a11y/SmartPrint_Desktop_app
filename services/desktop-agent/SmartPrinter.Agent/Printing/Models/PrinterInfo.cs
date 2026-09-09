namespace SmartPrinter.Agent.Printing.Models;

public enum PrinterAvailability
{
    Unknown = 0,
    Ready = 1,
    Offline = 2,
    Error = 3,
    PaperJam = 4,
    PaperOut = 5,
    Busy = 6
}

/// <summary>
/// Snapshot of a single Windows-installed printer, as returned by
/// <see cref="IPrinterService.DiscoverPrintersAsync"/>.
/// </summary>
public sealed record PrinterInfo
{
    /// <summary>The Windows printer name - the stable local identifier used for submission.</summary>
    public required string Name { get; init; }

    public required string DriverName { get; init; }

    public required string PortName { get; init; }

    public bool IsDefault { get; init; }

    public PrinterAvailability Availability { get; init; } = PrinterAvailability.Unknown;

    public bool SupportsColor { get; init; }

    public bool SupportsDuplex { get; init; }

    /// <summary>
    /// Fingerprint used to detect if the mapped printer silently changed underneath us
    /// (e.g. after a driver reinstall renamed the port). See ARCHITECTURE.md ("printer mapping drift").
    /// </summary>
    public string Fingerprint => $"{DriverName}|{PortName}";
}

public sealed record PrintOptions
{
    public int Copies { get; init; } = 1;

    public bool Color { get; init; }

    public bool Duplex { get; init; }

    /// <summary>Windows paper size id (DMPAPER_* constant) - defaults to A4 (9) if unsupported.</summary>
    public short PaperSize { get; init; } = 9;

    public bool Landscape { get; init; }
}

public enum PrintOutcomeStatus
{
    SubmittedToSpooler,
    Completed,
    Failed,
    Cancelled
}

public sealed record PrintOutcome
{
    public required PrintOutcomeStatus Status { get; init; }

    public int? SpoolerJobId { get; init; }

    public string? ErrorMessage { get; init; }

    public int PagesPrinted { get; init; }
}
