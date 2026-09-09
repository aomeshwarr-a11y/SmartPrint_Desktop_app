using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SmartPrinter.Agent.Configuration;
using SmartPrinter.Agent.Data;
using SmartPrinter.Agent.Data.Models;
using SmartPrinter.Agent.Printing;
using SmartPrinter.Agent.Printing.Models;

namespace SmartPrinter.Agent.Cloud;

/// <summary>
/// Orchestrates a single print job end-to-end: local idempotent enqueue -> secure
/// download -> Windows printing -> spooler monitoring -> cloud status update, with
/// crash-safe recovery. This is the class that turns "a Realtime event arrived" into
/// "a page came out of the printer (or a clearly reported failure)".
/// </summary>
public sealed class JobProcessor
{
    private readonly SqliteQueueRepository _queue;
    private readonly IPrinterService _printerService;
    private readonly SupabaseGateway _gateway;
    private readonly AgentOptions _options;
    private readonly ILogger<JobProcessor> _logger;

    public JobProcessor(
        SqliteQueueRepository queue,
        IPrinterService printerService,
        SupabaseGateway gateway,
        IOptions<AgentOptions> options,
        ILogger<JobProcessor> logger)
    {
        _queue = queue;
        _printerService = printerService;
        _gateway = gateway;
        _options = options.Value;
        _logger = logger;
    }

    /// <summary>
    /// Entry point for a freshly-assigned job (from Realtime or the catch-up query).
    /// Safe to call more than once for the same job - duplicate assignments are absorbed
    /// by the SQLite unique constraint on idempotency_key.
    /// </summary>
    public async Task HandleAssignedJobAsync(CloudPrintJob job, string printerWindowsName, CancellationToken cancellationToken)
    {
        var record = new PrintJobRecord
        {
            PrintJobId = job.Id.ToString(),
            IdempotencyKey = job.IdempotencyKey,
            PrinterId = job.PrinterId.ToString(),
            PrinterName = printerWindowsName,
            StoragePath = job.StoragePath,
            Status = LocalJobStatus.Queued,
            OptionsJson = job.PrintOptionsJson
        };

        var inserted = await _queue.TryEnqueueJobAsync(record, cancellationToken);
        if (!inserted)
        {
            return; // Already known locally - a previous run is handling (or already handled) it.
        }

        await ProcessAsync(record.PrintJobId, cancellationToken);
    }

    /// <summary>
    /// Runs (or resumes) a job through claim -> download -> print -> complete. Called both
    /// for brand-new jobs and, on startup, for jobs recovered in a non-terminal state.
    /// </summary>
    public async Task ProcessAsync(string printJobId, CancellationToken cancellationToken)
    {
        var job = await _queue.GetJobAsync(printJobId, cancellationToken);
        if (job == null || LocalJobStatus.Terminal.Contains(job.Status))
        {
            return;
        }

        try
        {
            if (job.Status == LocalJobStatus.Queued)
            {
                await _queue.UpdateStatusAsync(printJobId, LocalJobStatus.Claimed, cancellationToken: cancellationToken);
                await ReportCloudStatusAsync(job.PrintJobId, "claimed", null, cancellationToken);
                job = (await _queue.GetJobAsync(printJobId, cancellationToken))!;
            }

            string localFilePath;
            if (job.Status is LocalJobStatus.Claimed)
            {
                localFilePath = await DownloadAsync(job, cancellationToken);
                await _queue.UpdateStatusAsync(printJobId, LocalJobStatus.Downloaded, localFilePath: localFilePath, cancellationToken: cancellationToken);
                await ReportCloudStatusAsync(job.PrintJobId, "downloaded", null, cancellationToken);
                job = (await _queue.GetJobAsync(printJobId, cancellationToken))!;
            }

            if (job.Status == LocalJobStatus.Downloaded && job.LocalFilePath != null)
            {
                await PrintAsync(job, cancellationToken);
            }
        }
        catch (Exception ex)
        {
            await HandleFailureAsync(job, ex, cancellationToken);
        }
    }

    private async Task<string> DownloadAsync(PrintJobRecord job, CancellationToken cancellationToken)
    {
        await _queue.UpdateStatusAsync(job.PrintJobId, LocalJobStatus.Downloading, cancellationToken: cancellationToken);

        // --- File safety validation (SECURITY.md "customer file security") ---
        var extension = Path.GetExtension(job.StoragePath);
        if (!_options.AllowedFileExtensions.Contains(extension, StringComparer.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"Rejected file with disallowed extension '{extension}'.");
        }

        // Never trust a storage_path that tries to escape the expected prefix - defends
        // against a compromised/misbehaving backend or a crafted path in a replayed event.
        if (job.StoragePath.Contains("..", StringComparison.Ordinal) || Path.IsPathRooted(job.StoragePath))
        {
            throw new InvalidOperationException("Rejected storage path that looks like a path traversal attempt.");
        }

        var signedUrl = await RequestSignedUrlAsync(job, cancellationToken);
        var bytes = await _gateway.DownloadFromSignedUrlAsync(signedUrl, _options.MaxDownloadFileSizeBytes, cancellationToken);

        Directory.CreateDirectory(_options.ExpandedTempFileDirectory);
        // Use our own generated file name (never the customer-supplied one) written into a
        // directory scoped to this job id - defends against overwrite/traversal via a
        // malicious original filename and keeps cleanup trivial and unambiguous.
        var jobDir = Path.Combine(_options.ExpandedTempFileDirectory, job.PrintJobId);
        Directory.CreateDirectory(jobDir);
        var localPath = Path.Combine(jobDir, "document.pdf");

        await File.WriteAllBytesAsync(localPath, bytes, cancellationToken);

        if (!LooksLikePdf(bytes))
        {
            SafeDelete(localPath);
            throw new InvalidOperationException("Downloaded file does not have a valid PDF header - refusing to print.");
        }

        return localPath;
    }

    private async Task PrintAsync(PrintJobRecord job, CancellationToken cancellationToken)
    {
        await _queue.UpdateStatusAsync(job.PrintJobId, LocalJobStatus.Printing, cancellationToken: cancellationToken);
        await ReportCloudStatusAsync(job.PrintJobId, "printing", null, cancellationToken);

        var options = ParseOptions(job.OptionsJson);

        var outcome = await _printerService.SubmitDocumentAsync(
            job.PrinterName!, job.LocalFilePath!, options, job.IdempotencyKey, cancellationToken);

        if (outcome.Status == PrintOutcomeStatus.Failed)
        {
            throw new InvalidOperationException(outcome.ErrorMessage ?? "Print submission failed.");
        }

        var finalOutcome = outcome;
        if (outcome.SpoolerJobId.HasValue)
        {
            finalOutcome = await _printerService.WatchSpoolerJobAsync(
                job.PrinterName!, outcome.SpoolerJobId.Value, TimeSpan.FromMinutes(5), cancellationToken);
        }

        switch (finalOutcome.Status)
        {
            case PrintOutcomeStatus.Completed:
            case PrintOutcomeStatus.SubmittedToSpooler:
                await _queue.UpdateStatusAsync(job.PrintJobId, LocalJobStatus.Completed, spoolerJobId: finalOutcome.SpoolerJobId, cancellationToken: cancellationToken);
                await ReportCloudStatusAsync(job.PrintJobId, "completed", null, cancellationToken);
                CleanupJobFiles(job.PrintJobId);
                break;
            case PrintOutcomeStatus.Cancelled:
                await _queue.UpdateStatusAsync(job.PrintJobId, LocalJobStatus.Cancelled, cancellationToken: cancellationToken);
                await ReportCloudStatusAsync(job.PrintJobId, "cancelled", null, cancellationToken);
                CleanupJobFiles(job.PrintJobId);
                break;
            default:
                throw new InvalidOperationException(finalOutcome.ErrorMessage ?? "Printing failed at the spooler.");
        }
    }

    private async Task HandleFailureAsync(PrintJobRecord? job, Exception ex, CancellationToken cancellationToken)
    {
        if (job == null) return;

        _logger.LogError(ex, "Job {JobId} failed: {Message}", job.PrintJobId, ex.Message);
        await _queue.IncrementRetryAsync(job.PrintJobId, cancellationToken);
        var refreshed = await _queue.GetJobAsync(job.PrintJobId, cancellationToken);

        if (refreshed != null && refreshed.RetryCount < _options.JobRetryLimit)
        {
            _logger.LogInformation("Retrying job {JobId} (attempt {Attempt}/{Limit})", job.PrintJobId, refreshed.RetryCount + 1, _options.JobRetryLimit);
            await _queue.UpdateStatusAsync(job.PrintJobId, LocalJobStatus.Queued, error: ex.Message, cancellationToken: cancellationToken);
            await ProcessAsync(job.PrintJobId, cancellationToken);
        }
        else
        {
            await _queue.UpdateStatusAsync(job.PrintJobId, LocalJobStatus.Failed, error: ex.Message, cancellationToken: cancellationToken);
            await ReportCloudStatusAsync(job.PrintJobId, "failed", ex.Message, cancellationToken);
            CleanupJobFiles(job.PrintJobId);
        }
    }

    private async Task ReportCloudStatusAsync(string printJobId, string status, string? error, CancellationToken cancellationToken)
    {
        try
        {
            if (Guid.TryParse(printJobId, out var guid))
            {
                await _gateway.UpdatePrintJobStatusAsync(guid, status, error, cancellationToken);
            }
        }
        catch (Exception ex)
        {
            // Cloud reporting failing must never crash the local print pipeline - the local
            // SQLite state remains authoritative for resuming, and a background reconciler
            // (see Worker) periodically retries cloud sync for anything out of date.
            _logger.LogWarning(ex, "Failed to report status {Status} for job {JobId} to cloud - will retry later", status, printJobId);
        }
    }

    /// <summary>
    /// Called once at startup for every job left in a non-terminal state (see
    /// LocalJobStatus.RequiresRecoveryCheck) - resumes exactly where it left off rather
    /// than assuming success or restarting from scratch, per ARCHITECTURE.md §12.
    /// </summary>
    public async Task RecoverAsync(CancellationToken cancellationToken)
    {
        var stuck = await _queue.GetJobsByStatusAsync(LocalJobStatus.RequiresRecoveryCheck, cancellationToken);
        foreach (var job in stuck)
        {
            _logger.LogWarning("Recovering job {JobId} left in state {Status} after a restart/crash", job.PrintJobId, job.Status);

            if (job.Status == LocalJobStatus.Printing && job.SpoolerJobId.HasValue && job.PrinterName != null)
            {
                // We don't know if it finished printing before the crash - ask the spooler.
                var outcome = await _printerService.WatchSpoolerJobAsync(job.PrinterName, job.SpoolerJobId.Value, TimeSpan.FromSeconds(10), cancellationToken);
                if (outcome.Status is PrintOutcomeStatus.Completed or PrintOutcomeStatus.SubmittedToSpooler)
                {
                    await _queue.UpdateStatusAsync(job.PrintJobId, LocalJobStatus.Completed, cancellationToken: cancellationToken);
                    await ReportCloudStatusAsync(job.PrintJobId, "completed", "recovered-after-restart", cancellationToken);
                    continue;
                }
            }

            // For any other non-terminal state, safest is to resume the pipeline from
            // where the status column says we were - each step is itself idempotent.
            await ProcessAsync(job.PrintJobId, cancellationToken);
        }
    }

    private async Task<string> RequestSignedUrlAsync(PrintJobRecord job, CancellationToken cancellationToken)
    {
        var client = await _gateway.GetClientAsync();
        var signed = await client.Storage
            .From("print-uploads")
            .CreateSignedUrl(job.StoragePath, 600);
        return signed;
    }

    private static PrintOptions ParseOptions(string json)
    {
        try
        {
            var cloud = JsonSerializer.Deserialize<CloudPrintOptions>(json) ?? new CloudPrintOptions();
            return new PrintOptions
            {
                Copies = Math.Clamp(cloud.Copies, 1, 99),
                Color = cloud.Color,
                Duplex = cloud.Duplex,
                PaperSize = cloud.PaperSize,
                Landscape = cloud.Landscape
            };
        }
        catch
        {
            return new PrintOptions();
        }
    }

    private static bool LooksLikePdf(byte[] bytes) =>
        bytes.Length > 4 && bytes[0] == '%' && bytes[1] == 'P' && bytes[2] == 'D' && bytes[3] == 'F';

    private void CleanupJobFiles(string printJobId)
    {
        try
        {
            var jobDir = Path.Combine(_options.ExpandedTempFileDirectory, printJobId);
            if (Directory.Exists(jobDir))
            {
                Directory.Delete(jobDir, recursive: true);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to clean up temp files for job {JobId}", printJobId);
        }
    }

    private static void SafeDelete(string path)
    {
        try { File.Delete(path); } catch { /* best effort */ }
    }
}
