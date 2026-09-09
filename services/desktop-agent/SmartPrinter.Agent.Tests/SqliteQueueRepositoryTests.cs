using SmartPrinter.Agent.Data.Models;
using Xunit;

namespace SmartPrinter.Agent.Tests;

public class SqliteQueueRepositoryTests
{
    [Fact]
    public async Task TryEnqueueJobAsync_InsertsNewJob()
    {
        var (repo, _) = await TestHelpers.CreateRepositoryAsync();

        var job = NewJob("job-1", "idem-1");
        var inserted = await repo.TryEnqueueJobAsync(job);

        Assert.True(inserted);
        var stored = await repo.GetJobAsync("job-1");
        Assert.NotNull(stored);
        Assert.Equal(LocalJobStatus.Queued, stored!.Status);
    }

    [Fact]
    public async Task TryEnqueueJobAsync_DuplicateIdempotencyKey_IsIgnored()
    {
        var (repo, _) = await TestHelpers.CreateRepositoryAsync();

        var first = NewJob("job-1", "idem-shared");
        var second = NewJob("job-2", "idem-shared"); // different job id, SAME idempotency key

        var firstInserted = await repo.TryEnqueueJobAsync(first);
        var secondInserted = await repo.TryEnqueueJobAsync(second);

        Assert.True(firstInserted);
        Assert.False(secondInserted, "A second job sharing an idempotency key must never be enqueued - this is the primary duplicate-print guard.");
        Assert.Null(await repo.GetJobAsync("job-2"));
    }

    [Fact]
    public async Task UpdateStatusAsync_TransitionsThroughLifecycle_AndStampsTimestamps()
    {
        var (repo, _) = await TestHelpers.CreateRepositoryAsync();
        await repo.TryEnqueueJobAsync(NewJob("job-1", "idem-1"));

        await repo.UpdateStatusAsync("job-1", LocalJobStatus.Claimed);
        var claimed = await repo.GetJobAsync("job-1");
        Assert.Equal(LocalJobStatus.Claimed, claimed!.Status);
        Assert.NotNull(claimed.ClaimedAt);

        await repo.UpdateStatusAsync("job-1", LocalJobStatus.Downloaded, localFilePath: @"C:\temp\doc.pdf");
        var downloaded = await repo.GetJobAsync("job-1");
        Assert.Equal(LocalJobStatus.Downloaded, downloaded!.Status);
        Assert.NotNull(downloaded.DownloadedAt);
        Assert.Equal(@"C:\temp\doc.pdf", downloaded.LocalFilePath);

        await repo.UpdateStatusAsync("job-1", LocalJobStatus.Completed, spoolerJobId: 42);
        var completed = await repo.GetJobAsync("job-1");
        Assert.Equal(LocalJobStatus.Completed, completed!.Status);
        Assert.NotNull(completed.PrintedAt);
        Assert.Equal(42, completed.SpoolerJobId);
    }

    [Fact]
    public async Task GetJobsByStatusAsync_ReturnsOnlyRequestedStatuses()
    {
        var (repo, _) = await TestHelpers.CreateRepositoryAsync();
        await repo.TryEnqueueJobAsync(NewJob("job-1", "idem-1"));
        await repo.TryEnqueueJobAsync(NewJob("job-2", "idem-2"));
        await repo.UpdateStatusAsync("job-2", LocalJobStatus.Completed);

        var queued = await repo.GetJobsByStatusAsync(new[] { LocalJobStatus.Queued });
        var completed = await repo.GetJobsByStatusAsync(new[] { LocalJobStatus.Completed });

        Assert.Single(queued);
        Assert.Equal("job-1", queued[0].PrintJobId);
        Assert.Single(completed);
        Assert.Equal("job-2", completed[0].PrintJobId);
    }

    [Fact]
    public async Task IncrementRetryAsync_IncrementsCount()
    {
        var (repo, _) = await TestHelpers.CreateRepositoryAsync();
        await repo.TryEnqueueJobAsync(NewJob("job-1", "idem-1"));

        await repo.IncrementRetryAsync("job-1");
        await repo.IncrementRetryAsync("job-1");

        var job = await repo.GetJobAsync("job-1");
        Assert.Equal(2, job!.RetryCount);
    }

    [Fact]
    public async Task RequiresRecoveryCheck_FlagsNonTerminalStates()
    {
        var (repo, _) = await TestHelpers.CreateRepositoryAsync();
        await repo.TryEnqueueJobAsync(NewJob("job-1", "idem-1"));
        await repo.UpdateStatusAsync("job-1", LocalJobStatus.Printing);

        // Simulates the check Worker/JobProcessor.RecoverAsync performs on startup.
        var stuck = await repo.GetJobsByStatusAsync(LocalJobStatus.RequiresRecoveryCheck);

        Assert.Single(stuck);
        Assert.Equal("job-1", stuck[0].PrintJobId);
    }

    [Fact]
    public async Task Settings_RoundTripsThroughKeyValueStore()
    {
        var (repo, _) = await TestHelpers.CreateRepositoryAsync();

        await repo.SetSettingAsync("log_verbosity", "Debug");
        var value = await repo.GetSettingAsync("log_verbosity");

        Assert.Equal("Debug", value);
    }

    [Fact]
    public async Task PrinterCache_UpsertUpdatesExistingRow()
    {
        var (repo, _) = await TestHelpers.CreateRepositoryAsync();

        await repo.UpsertPrinterCacheAsync(new PrinterCacheRecord
        {
            PrinterName = "HP LaserJet",
            DriverName = "HP Universal",
            PortName = "USB001",
            IsAuthorized = false
        });
        await repo.UpsertPrinterCacheAsync(new PrinterCacheRecord
        {
            PrinterName = "HP LaserJet",
            DriverName = "HP Universal",
            PortName = "USB001",
            IsAuthorized = true
        });

        var cached = await repo.GetCachedPrintersAsync();
        var printer = Assert.Single(cached);
        Assert.True(printer.IsAuthorized);
    }

    private static PrintJobRecord NewJob(string id, string idempotencyKey) => new()
    {
        PrintJobId = id,
        IdempotencyKey = idempotencyKey,
        PrinterId = "printer-1",
        PrinterName = "Test Printer",
        StoragePath = "orders/order-1/document.pdf",
        Status = LocalJobStatus.Queued
    };
}
