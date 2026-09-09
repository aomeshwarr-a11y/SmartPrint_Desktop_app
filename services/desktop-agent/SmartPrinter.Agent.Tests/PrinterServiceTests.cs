using SmartPrinter.Agent.Printing;
using SmartPrinter.Agent.Printing.Models;
using Xunit;

namespace SmartPrinter.Agent.Tests;

/// <summary>
/// These tests exercise the <see cref="IPrinterService"/> CONTRACT against a fake
/// in-memory implementation. They intentionally do NOT touch the real
/// <see cref="WindowsPrinterService"/> Win32 P/Invoke code, because that requires an
/// actual Windows machine with real printer drivers installed - see
/// docs/TROUBLESHOOTING.md "Manual Hardware Test Checklist" for the physical-printer
/// test plan that WindowsPrinterService itself must be validated against by hand.
/// </summary>
public class PrinterServiceTests
{
    private sealed class FakePrinterService : IPrinterService
    {
        public List<string> SubmittedIdempotencyKeys { get; } = new();
        public PrinterAvailability AvailabilityToReturn { get; set; } = PrinterAvailability.Ready;

        public Task<IReadOnlyList<PrinterInfo>> DiscoverPrintersAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<PrinterInfo>>(new List<PrinterInfo>
            {
                new() { Name = "Fake Laser", DriverName = "FakeDriver", PortName = "USB001", IsDefault = true, Availability = PrinterAvailability.Ready, SupportsColor = false, SupportsDuplex = true }
            });

        public Task<PrinterAvailability> GetAvailabilityAsync(string printerName, CancellationToken cancellationToken = default) =>
            Task.FromResult(AvailabilityToReturn);

        public Task<PrintOutcome> SubmitDocumentAsync(string printerName, string localFilePath, PrintOptions options, string idempotencyKey, CancellationToken cancellationToken = default)
        {
            if (SubmittedIdempotencyKeys.Contains(idempotencyKey))
            {
                throw new InvalidOperationException("Duplicate physical print attempt detected in fake - this should never happen.");
            }
            SubmittedIdempotencyKeys.Add(idempotencyKey);
            return Task.FromResult(new PrintOutcome { Status = PrintOutcomeStatus.SubmittedToSpooler, SpoolerJobId = 1, PagesPrinted = 1 });
        }

        public Task<PrintOutcome> WatchSpoolerJobAsync(string printerName, int spoolerJobId, TimeSpan timeout, CancellationToken cancellationToken = default) =>
            Task.FromResult(new PrintOutcome { Status = PrintOutcomeStatus.Completed, SpoolerJobId = spoolerJobId, PagesPrinted = 1 });

        public Task CancelJobAsync(string printerName, int spoolerJobId, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }

    [Fact]
    public async Task DiscoverPrintersAsync_ReturnsAtLeastOnePrinter()
    {
        var service = new FakePrinterService();
        var printers = await service.DiscoverPrintersAsync();
        Assert.NotEmpty(printers);
    }

    [Fact]
    public async Task SubmitDocumentAsync_SameIdempotencyKeyTwice_IsRejectedByContract()
    {
        var service = new FakePrinterService();
        await service.SubmitDocumentAsync("Fake Laser", "doc.pdf", new PrintOptions(), "job-1");

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.SubmitDocumentAsync("Fake Laser", "doc.pdf", new PrintOptions(), "job-1"));
    }

    [Fact]
    public void PrinterInfo_Fingerprint_CombinesDriverAndPort()
    {
        var printer = new PrinterInfo { Name = "X", DriverName = "DriverA", PortName = "PortB" };
        Assert.Equal("DriverA|PortB", printer.Fingerprint);
    }

    [Fact]
    public async Task WatchSpoolerJobAsync_ReportsCompletedWithPageCount()
    {
        var service = new FakePrinterService();
        var outcome = await service.WatchSpoolerJobAsync("Fake Laser", 1, TimeSpan.FromSeconds(1));
        Assert.Equal(PrintOutcomeStatus.Completed, outcome.Status);
        Assert.Equal(1, outcome.PagesPrinted);
    }
}
