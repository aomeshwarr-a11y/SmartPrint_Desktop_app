using System.Drawing;
using System.Drawing.Printing;
using System.Runtime.InteropServices;
using Microsoft.Extensions.Logging;
using SmartPrinter.Agent.Printing.Models;

namespace SmartPrinter.Agent.Printing;

/// <summary>
/// Real Windows implementation of <see cref="IPrinterService"/>. Uses the Win32 print
/// spooler (winspool.drv, via <see cref="NativeMethods"/>) for enumeration, capability
/// detection, status polling, and job monitoring, and <see cref="System.Drawing.Printing.PrintDocument"/>
/// (which itself submits through the same spooler) to actually push rendered pages to
/// the printer.
///
/// IMPORTANT (honesty, per ARCHITECTURE.md §5): the spooler can tell us a job was
/// accepted, is printing, or left the queue - it generally cannot confirm ink actually
/// hit paper for printers that don't report that back to their driver. We surface
/// "SubmittedToSpooler" -> "Completed" (left the queue with no error) as our best signal,
/// and rely on the manual "confirm printed" dashboard fallback for disputes.
/// </summary>
public sealed class WindowsPrinterService : IPrinterService
{
    private readonly IPdfPrintEngine _pdfEngine;
    private readonly ILogger<WindowsPrinterService> _logger;

    public WindowsPrinterService(IPdfPrintEngine pdfEngine, ILogger<WindowsPrinterService> logger)
    {
        _pdfEngine = pdfEngine;
        _logger = logger;
    }

    public Task<IReadOnlyList<PrinterInfo>> DiscoverPrintersAsync(CancellationToken cancellationToken = default)
    {
        return Task.Run(() =>
        {
            var results = new List<PrinterInfo>();
            var defaultPrinter = new PrinterSettings().PrinterName;

            EnumPrinterInfo2(printer =>
            {
                var availability = DecodeStatus(printer.Status);
                var (supportsDuplex, supportsColor) = QueryCapabilities(printer.pPrinterName!, printer.pPortName!);

                results.Add(new PrinterInfo
                {
                    Name = printer.pPrinterName!,
                    DriverName = printer.pDriverName ?? "unknown",
                    PortName = printer.pPortName ?? "unknown",
                    IsDefault = string.Equals(printer.pPrinterName, defaultPrinter, StringComparison.OrdinalIgnoreCase),
                    Availability = availability,
                    SupportsDuplex = supportsDuplex,
                    SupportsColor = supportsColor
                });
            });

            _logger.LogInformation("Discovered {Count} Windows printers", results.Count);
            return (IReadOnlyList<PrinterInfo>)results;
        }, cancellationToken);
    }

    public Task<PrinterAvailability> GetAvailabilityAsync(string printerName, CancellationToken cancellationToken = default)
    {
        return Task.Run(() =>
        {
            if (!NativeMethods.OpenPrinter(printerName, out var handle, IntPtr.Zero))
            {
                _logger.LogWarning("OpenPrinter failed for {Printer} (Win32 error {Error})", printerName, Marshal.GetLastWin32Error());
                return PrinterAvailability.Unknown;
            }

            try
            {
                NativeMethods.GetPrinter(handle, 2, IntPtr.Zero, 0, out var needed);
                var buffer = Marshal.AllocHGlobal((int)needed);
                try
                {
                    if (!NativeMethods.GetPrinter(handle, 2, buffer, needed, out _))
                    {
                        return PrinterAvailability.Unknown;
                    }

                    var info = Marshal.PtrToStructure<NativeMethods.PRINTER_INFO_2>(buffer);
                    return DecodeStatus(info.Status);
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
            finally
            {
                NativeMethods.ClosePrinter(handle);
            }
        }, cancellationToken);
    }

    public Task<PrintOutcome> SubmitDocumentAsync(
        string printerName,
        string localFilePath,
        PrintOptions options,
        string idempotencyKey,
        CancellationToken cancellationToken = default)
    {
        return Task.Run(() =>
        {
            using var pdf = _pdfEngine.Open(localFilePath);
            var pageCount = pdf.PageCount;
            if (pageCount <= 0)
            {
                return new PrintOutcome
                {
                    Status = PrintOutcomeStatus.Failed,
                    ErrorMessage = "PDF has no renderable pages."
                };
            }

            // The document name is what lets us find the spooler job id after submission
            // (the spooler API does not hand PrintDocument a job id directly), and it also
            // shows up in Windows' own print queue UI if the shop owner opens it.
            var documentName = $"SmartPrinter-{idempotencyKey}";
            var submittedAfter = DateTime.UtcNow.AddSeconds(-2);

            using var printDocument = new PrintDocument();
            printDocument.PrinterSettings.PrinterName = printerName;
            printDocument.DocumentName = documentName;
            printDocument.PrinterSettings.Copies = (short)Math.Max(1, options.Copies);

            if (printDocument.PrinterSettings.CanDuplex)
            {
                printDocument.PrinterSettings.Duplex = options.Duplex ? Duplex.Vertical : Duplex.Simplex;
            }

            printDocument.DefaultPageSettings.Color = options.Color;
            printDocument.DefaultPageSettings.Landscape = options.Landscape;

            try
            {
                var paperSize = FindPaperSize(printDocument.PrinterSettings, options.PaperSize);
                if (paperSize != null)
                {
                    printDocument.DefaultPageSettings.PaperSize = paperSize;
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Requested paper size not supported by {Printer}, falling back to driver default", printerName);
            }

            var currentPage = 0;
            printDocument.PrintPage += (_, e) =>
            {
                using var pageImage = pdf.RenderPageToImage(currentPage, e.PageBounds.Width, e.PageBounds.Height);
                e.Graphics!.DrawImage(pageImage, e.PageBounds);
                currentPage++;
                e.HasMorePages = currentPage < pageCount;
            };

            try
            {
                printDocument.Print();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "PrintDocument.Print() failed for {Printer} job {Idempotency}", printerName, idempotencyKey);
                return new PrintOutcome { Status = PrintOutcomeStatus.Failed, ErrorMessage = ex.Message };
            }

            var jobId = FindSubmittedJobId(printerName, documentName, submittedAfter);
            if (jobId == null)
            {
                // The job may have already completed and left the queue before we could
                // enumerate it (common for very fast/local drivers) - treat as submitted
                // rather than failed, since PrintDocument.Print() did not throw.
                _logger.LogInformation(
                    "Job {Idempotency} left the spooler queue before it could be matched by name - treating as submitted", idempotencyKey);
                return new PrintOutcome { Status = PrintOutcomeStatus.SubmittedToSpooler, PagesPrinted = pageCount };
            }

            _logger.LogInformation("Submitted job {Idempotency} to {Printer} as spooler job {JobId}", idempotencyKey, printerName, jobId);
            return new PrintOutcome { Status = PrintOutcomeStatus.SubmittedToSpooler, SpoolerJobId = jobId, PagesPrinted = pageCount };
        }, cancellationToken);
    }

    public Task<PrintOutcome> WatchSpoolerJobAsync(
        string printerName, int spoolerJobId, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        return Task.Run(async () =>
        {
            var deadline = DateTime.UtcNow.Add(timeout);

            if (!NativeMethods.OpenPrinter(printerName, out var handle, IntPtr.Zero))
            {
                return new PrintOutcome { Status = PrintOutcomeStatus.Failed, ErrorMessage = "Unable to open printer handle to watch job." };
            }

            try
            {
                while (DateTime.UtcNow < deadline && !cancellationToken.IsCancellationRequested)
                {
                    NativeMethods.GetJob(handle, (uint)spoolerJobId, 2, IntPtr.Zero, 0, out var needed);
                    if (needed == 0)
                    {
                        // Job id no longer known to the spooler at all - it either completed
                        // and was purged, or was deleted. We cannot distinguish the two here,
                        // which is exactly the physical-completion honesty limit noted above.
                        return new PrintOutcome { Status = PrintOutcomeStatus.Completed, SpoolerJobId = spoolerJobId };
                    }

                    var buffer = Marshal.AllocHGlobal((int)needed);
                    try
                    {
                        if (!NativeMethods.GetJob(handle, (uint)spoolerJobId, 2, buffer, needed, out _))
                        {
                            return new PrintOutcome { Status = PrintOutcomeStatus.Completed, SpoolerJobId = spoolerJobId };
                        }

                        var job = Marshal.PtrToStructure<NativeMethods.JOB_INFO_2>(buffer);

                        if ((job.Status & NativeMethods.JOB_STATUS_ERROR) != 0 ||
                            (job.Status & NativeMethods.JOB_STATUS_USER_INTERVENTION) != 0)
                        {
                            return new PrintOutcome
                            {
                                Status = PrintOutcomeStatus.Failed,
                                SpoolerJobId = spoolerJobId,
                                ErrorMessage = job.pStatus ?? "Spooler reported a job error.",
                                PagesPrinted = (int)job.PagesPrinted
                            };
                        }

                        if ((job.Status & NativeMethods.JOB_STATUS_DELETED) != 0)
                        {
                            return new PrintOutcome { Status = PrintOutcomeStatus.Cancelled, SpoolerJobId = spoolerJobId };
                        }

                        if ((job.Status & NativeMethods.JOB_STATUS_PRINTED) != 0)
                        {
                            return new PrintOutcome
                            {
                                Status = PrintOutcomeStatus.Completed,
                                SpoolerJobId = spoolerJobId,
                                PagesPrinted = (int)job.PagesPrinted
                            };
                        }
                    }
                    finally
                    {
                        Marshal.FreeHGlobal(buffer);
                    }

                    await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
                }

                return new PrintOutcome { Status = PrintOutcomeStatus.SubmittedToSpooler, SpoolerJobId = spoolerJobId, ErrorMessage = "Timed out waiting for spooler to report completion." };
            }
            finally
            {
                NativeMethods.ClosePrinter(handle);
            }
        }, cancellationToken);
    }

    public Task CancelJobAsync(string printerName, int spoolerJobId, CancellationToken cancellationToken = default)
    {
        return Task.Run(() =>
        {
            if (!NativeMethods.OpenPrinter(printerName, out var handle, IntPtr.Zero))
            {
                return;
            }

            try
            {
                NativeMethods.SetJob(handle, (uint)spoolerJobId, 0, IntPtr.Zero, NativeMethods.JOB_CONTROL_CANCEL);
            }
            finally
            {
                NativeMethods.ClosePrinter(handle);
            }
        }, cancellationToken);
    }

    // ---- helpers ----

    private void EnumPrinterInfo2(Action<NativeMethods.PRINTER_INFO_2> onPrinter)
    {
        const int flags = NativeMethods.PRINTER_ENUM_LOCAL | NativeMethods.PRINTER_ENUM_CONNECTIONS;

        NativeMethods.EnumPrinters(flags, null, 2, IntPtr.Zero, 0, out var needed, out _);
        if (needed == 0) return;

        var buffer = Marshal.AllocHGlobal((int)needed);
        try
        {
            if (!NativeMethods.EnumPrinters(flags, null, 2, buffer, needed, out _, out var returned))
            {
                _logger.LogWarning("EnumPrinters failed with Win32 error {Error}", Marshal.GetLastWin32Error());
                return;
            }

            var structSize = Marshal.SizeOf<NativeMethods.PRINTER_INFO_2>();
            for (var i = 0; i < returned; i++)
            {
                var current = IntPtr.Add(buffer, i * structSize);
                var info = Marshal.PtrToStructure<NativeMethods.PRINTER_INFO_2>(current);
                if (!string.IsNullOrEmpty(info.pPrinterName))
                {
                    onPrinter(info);
                }
            }
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private (bool duplex, bool color) QueryCapabilities(string printerName, string portName)
    {
        try
        {
            var duplex = NativeMethods.DeviceCapabilities(printerName, portName, NativeMethods.DC_DUPLEX, IntPtr.Zero, IntPtr.Zero) == 1;
            var colorCount = NativeMethods.DeviceCapabilities(printerName, portName, NativeMethods.DC_COLORDEVICE, IntPtr.Zero, IntPtr.Zero);
            return (duplex, colorCount == 1);
        }
        catch
        {
            return (false, false);
        }
    }

    private static PrinterAvailability DecodeStatus(uint status)
    {
        if ((status & NativeMethods.PRINTER_STATUS_NOT_AVAILABLE) != 0 || (status & NativeMethods.PRINTER_STATUS_OFFLINE) != 0)
            return PrinterAvailability.Offline;
        if ((status & NativeMethods.PRINTER_STATUS_PAPER_JAM) != 0)
            return PrinterAvailability.PaperJam;
        if ((status & NativeMethods.PRINTER_STATUS_PAPER_OUT) != 0)
            return PrinterAvailability.PaperOut;
        if ((status & NativeMethods.PRINTER_STATUS_ERROR) != 0)
            return PrinterAvailability.Error;
        if ((status & NativeMethods.PRINTER_STATUS_BUSY) != 0 || (status & NativeMethods.PRINTER_STATUS_PRINTING) != 0)
            return PrinterAvailability.Busy;
        return PrinterAvailability.Ready;
    }

    private static PaperSize? FindPaperSize(PrinterSettings settings, short kind)
    {
        foreach (PaperSize size in settings.PaperSizes)
        {
            if ((short)size.RawKind == kind) return size;
        }
        return null;
    }

    private int? FindSubmittedJobId(string printerName, string documentName, DateTime submittedAfterUtc)
    {
        if (!NativeMethods.OpenPrinter(printerName, out var handle, IntPtr.Zero))
        {
            return null;
        }

        try
        {
            NativeMethods.EnumJobs(handle, 0, 256, 2, IntPtr.Zero, 0, out var needed, out _);
            if (needed == 0) return null;

            var buffer = Marshal.AllocHGlobal((int)needed);
            try
            {
                if (!NativeMethods.EnumJobs(handle, 0, 256, 2, buffer, needed, out _, out var returned))
                {
                    return null;
                }

                var structSize = Marshal.SizeOf<NativeMethods.JOB_INFO_2>();
                int? bestMatch = null;
                uint bestJobId = 0;

                for (var i = 0; i < returned; i++)
                {
                    var current = IntPtr.Add(buffer, i * structSize);
                    var job = Marshal.PtrToStructure<NativeMethods.JOB_INFO_2>(current);
                    if (string.Equals(job.pDocument, documentName, StringComparison.Ordinal) && job.JobId >= bestJobId)
                    {
                        bestJobId = job.JobId;
                        bestMatch = (int)job.JobId;
                    }
                }

                return bestMatch;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
        finally
        {
            NativeMethods.ClosePrinter(handle);
        }
    }
}
