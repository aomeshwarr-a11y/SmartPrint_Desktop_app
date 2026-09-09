using SmartPrinter.Agent.Printing.Models;

namespace SmartPrinter.Agent.Printing;

/// <summary>
/// Abstraction over the Windows print subsystem. The rest of the application (job
/// processing, IPC, SQLite state machine) depends only on this interface, never on
/// Win32 calls directly - so the printing backend can be swapped or unit-tested with
/// a fake implementation without touching business logic.
/// </summary>
public interface IPrinterService
{
    /// <summary>Enumerates all printers currently installed in Windows for the current user/session.</summary>
    Task<IReadOnlyList<PrinterInfo>> DiscoverPrintersAsync(CancellationToken cancellationToken = default);

    /// <summary>Re-reads live status (offline/ready/error) for a single named printer.</summary>
    Task<PrinterAvailability> GetAvailabilityAsync(string printerName, CancellationToken cancellationToken = default);

    /// <summary>
    /// Submits a rendered document (already rasterized to printable pages by the PDF engine)
    /// to the given Windows printer via the spooler, and returns the spooler job id and
    /// initial acceptance status. Does NOT wait for physical completion - see
    /// <see cref="WatchSpoolerJobAsync"/> for the honest limits of what can be observed next.
    /// </summary>
    Task<PrintOutcome> SubmitDocumentAsync(
        string printerName,
        string localFilePath,
        PrintOptions options,
        string idempotencyKey,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Polls the spooler for the given job id until it leaves the queue (completed, error,
    /// deleted) or the timeout elapses. Returns the last known status. See WINDOWS-PRINTERS.md
    /// for the documented limits of spooler-level completion detection.
    /// </summary>
    Task<PrintOutcome> WatchSpoolerJobAsync(
        string printerName,
        int spoolerJobId,
        TimeSpan timeout,
        CancellationToken cancellationToken = default);

    Task CancelJobAsync(string printerName, int spoolerJobId, CancellationToken cancellationToken = default);
}
