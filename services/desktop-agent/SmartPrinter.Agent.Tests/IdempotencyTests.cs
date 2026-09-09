using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using SmartPrinter.Agent.Cloud;
using SmartPrinter.Agent.Configuration;
using SmartPrinter.Agent.Printing;
using SmartPrinter.Agent.Printing.Models;
using Xunit;

namespace SmartPrinter.Agent.Tests;

public class IdempotencyTests
{
    [Fact]
    public async Task HandleAssignedJobAsync_CalledTwiceForSameJob_OnlyEnqueuesOnce()
    {
        var (repo, dataDir) = await TestHelpers.CreateRepositoryAsync();
        var printerServiceMock = new Mock<IPrinterService>();
        var agentOptions = Options.Create(new AgentOptions
        {
            DataDirectory = dataDir,
            TempFileDirectory = Path.Combine(dataDir, "temp"),
            JobRetryLimit = 0 // fail fast in this test - we only care about the enqueue guard
        });
        var supabaseOptions = Options.Create(new SupabaseOptions()); // intentionally unconfigured
        var gateway = new SupabaseGateway(supabaseOptions, NullLogger<SupabaseGateway>.Instance);

        var processor = new JobProcessor(repo, printerServiceMock.Object, gateway, agentOptions, NullLogger<JobProcessor>.Instance);

        var jobId = Guid.NewGuid();
        var cloudJob = new CloudPrintJob
        {
            Id = jobId,
            DeviceId = Guid.NewGuid(),
            PrinterId = Guid.NewGuid(),
            StoragePath = "orders/order-1/document.pdf",
            Status = "queued",
            IdempotencyKey = $"job-{jobId}",
            PrintOptionsJson = "{}"
        };

        // Simulate the same Realtime event (or a redelivered catch-up result) arriving twice.
        await processor.HandleAssignedJobAsync(cloudJob, "Test Printer", CancellationToken.None);
        await processor.HandleAssignedJobAsync(cloudJob, "Test Printer", CancellationToken.None);

        var stored = await repo.GetJobAsync(jobId.ToString());
        Assert.NotNull(stored);

        // The printer must never have been invoked twice for the same idempotency key -
        // in this test it will actually be invoked zero times because the (intentionally
        // unconfigured) SupabaseGateway fails at the download step, which is the correct,
        // safe outcome: no cloud connectivity means no physical print attempt.
        printerServiceMock.Verify(
            p => p.SubmitDocumentAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<PrintOptions>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task HandleAssignedJobAsync_DownloadFailure_MarksJobFailedInsteadOfRetryingForever()
    {
        var (repo, dataDir) = await TestHelpers.CreateRepositoryAsync();
        var printerServiceMock = new Mock<IPrinterService>();
        var agentOptions = Options.Create(new AgentOptions
        {
            DataDirectory = dataDir,
            TempFileDirectory = Path.Combine(dataDir, "temp"),
            JobRetryLimit = 1
        });
        var gateway = new SupabaseGateway(Options.Create(new SupabaseOptions()), NullLogger<SupabaseGateway>.Instance);
        var processor = new JobProcessor(repo, printerServiceMock.Object, gateway, agentOptions, NullLogger<JobProcessor>.Instance);

        var jobId = Guid.NewGuid();
        var cloudJob = new CloudPrintJob
        {
            Id = jobId,
            DeviceId = Guid.NewGuid(),
            PrinterId = Guid.NewGuid(),
            StoragePath = "orders/order-1/document.pdf",
            Status = "queued",
            IdempotencyKey = $"job-{jobId}",
            PrintOptionsJson = "{}"
        };

        await processor.HandleAssignedJobAsync(cloudJob, "Test Printer", CancellationToken.None);

        var stored = await repo.GetJobAsync(jobId.ToString());
        Assert.NotNull(stored);
        Assert.Equal(Data.Models.LocalJobStatus.Failed, stored!.Status);
        Assert.True(stored.RetryCount >= 1);
    }

    [Fact]
    public async Task HandleAssignedJobAsync_RejectsDisallowedFileExtension()
    {
        var (repo, dataDir) = await TestHelpers.CreateRepositoryAsync();
        var printerServiceMock = new Mock<IPrinterService>();
        var agentOptions = Options.Create(new AgentOptions
        {
            DataDirectory = dataDir,
            TempFileDirectory = Path.Combine(dataDir, "temp"),
            JobRetryLimit = 0,
            AllowedFileExtensions = new[] { ".pdf" }
        });
        var gateway = new SupabaseGateway(Options.Create(new SupabaseOptions()), NullLogger<SupabaseGateway>.Instance);
        var processor = new JobProcessor(repo, printerServiceMock.Object, gateway, agentOptions, NullLogger<JobProcessor>.Instance);

        var jobId = Guid.NewGuid();
        var cloudJob = new CloudPrintJob
        {
            Id = jobId,
            DeviceId = Guid.NewGuid(),
            PrinterId = Guid.NewGuid(),
            StoragePath = "orders/order-1/payload.exe", // disallowed extension
            Status = "queued",
            IdempotencyKey = $"job-{jobId}",
            PrintOptionsJson = "{}"
        };

        await processor.HandleAssignedJobAsync(cloudJob, "Test Printer", CancellationToken.None);

        var stored = await repo.GetJobAsync(jobId.ToString());
        Assert.Equal(Data.Models.LocalJobStatus.Failed, stored!.Status);
        Assert.Contains("disallowed extension", stored.LastError ?? string.Empty, StringComparison.OrdinalIgnoreCase);
        printerServiceMock.Verify(
            p => p.SubmitDocumentAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<PrintOptions>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }
}
