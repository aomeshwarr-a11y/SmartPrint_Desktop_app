using System.Globalization;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SmartPrinter.Agent.Configuration;
using SmartPrinter.Agent.Data.Models;

namespace SmartPrinter.Agent.Data;

/// <summary>
/// Owns the local SQLite durable queue. This is the only class that talks to the SQLite
/// file directly - everything else (JobProcessor, IpcRouter) goes through this repository,
/// which keeps the state-machine rules (see <see cref="LocalJobStatus"/>) enforced in one
/// place instead of scattered across callers.
/// </summary>
public sealed class SqliteQueueRepository
{
    private readonly string _connectionString;
    private readonly ILogger<SqliteQueueRepository> _logger;
    private readonly SemaphoreSlim _writeLock = new(1, 1);

    public SqliteQueueRepository(IOptions<AgentOptions> options, ILogger<SqliteQueueRepository> logger)
    {
        _logger = logger;
        var dataDir = options.Value.ExpandedDataDirectory;
        Directory.CreateDirectory(dataDir);
        var dbPath = Path.Combine(dataDir, "agent.db");
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = dbPath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared
        }.ToString();
    }

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        var migrationPath = Path.Combine(AppContext.BaseDirectory, "Data", "Migrations", "001_initial.sql");
        if (!File.Exists(migrationPath))
        {
            // Fallback for when the content file wasn't copied next to the binary for some reason.
            migrationPath = Path.Combine(AppContext.BaseDirectory, "001_initial.sql");
        }

        var sql = await File.ReadAllTextAsync(migrationPath, cancellationToken);

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;" + sql;
        await command.ExecuteNonQueryAsync(cancellationToken);

        _logger.LogInformation("Local SQLite queue initialized at {Path}", connection.DataSource);
    }

    // ---------------- print_jobs ----------------

    /// <summary>
    /// Inserts a newly-assigned job, or is a no-op if a job with the same idempotency key
    /// already exists locally - this is the primary duplicate-physical-print guard.
    /// </summary>
    public async Task<bool> TryEnqueueJobAsync(PrintJobRecord job, CancellationToken cancellationToken = default)
    {
        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            await using var connection = await OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = """
                INSERT INTO print_jobs
                    (print_job_id, idempotency_key, printer_id, printer_name, storage_path, status, options_json)
                VALUES
                    ($id, $idem, $printerId, $printerName, $storagePath, $status, $options)
                ON CONFLICT(idempotency_key) DO NOTHING;
                """;
            command.Parameters.AddWithValue("$id", job.PrintJobId);
            command.Parameters.AddWithValue("$idem", job.IdempotencyKey);
            command.Parameters.AddWithValue("$printerId", job.PrinterId);
            command.Parameters.AddWithValue("$printerName", (object?)job.PrinterName ?? DBNull.Value);
            command.Parameters.AddWithValue("$storagePath", job.StoragePath);
            command.Parameters.AddWithValue("$status", job.Status);
            command.Parameters.AddWithValue("$options", job.OptionsJson);

            var rows = await command.ExecuteNonQueryAsync(cancellationToken);
            if (rows == 0)
            {
                _logger.LogInformation("Job {Idempotency} already enqueued locally - ignoring duplicate assignment", job.IdempotencyKey);
            }
            return rows > 0;
        }
        finally
        {
            _writeLock.Release();
        }
    }

    public async Task UpdateStatusAsync(
        string printJobId, string newStatus, string? error = null, int? spoolerJobId = null,
        string? localFilePath = null, CancellationToken cancellationToken = default)
    {
        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            await using var connection = await OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = """
                UPDATE print_jobs SET
                    status = $status,
                    last_error = $error,
                    spooler_job_id = COALESCE($spoolerJobId, spooler_job_id),
                    local_file_path = COALESCE($localFilePath, local_file_path),
                    claimed_at = CASE WHEN $status = 'claimed' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE claimed_at END,
                    downloaded_at = CASE WHEN $status = 'downloaded' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE downloaded_at END,
                    printed_at = CASE WHEN $status = 'completed' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE printed_at END,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                WHERE print_job_id = $id;
                """;
            command.Parameters.AddWithValue("$status", newStatus);
            command.Parameters.AddWithValue("$error", (object?)error ?? DBNull.Value);
            command.Parameters.AddWithValue("$spoolerJobId", (object?)spoolerJobId ?? DBNull.Value);
            command.Parameters.AddWithValue("$localFilePath", (object?)localFilePath ?? DBNull.Value);
            command.Parameters.AddWithValue("$id", printJobId);
            await command.ExecuteNonQueryAsync(cancellationToken);

            await InsertEventInternalAsync(connection, printJobId, "status_changed", newStatus, cancellationToken);
        }
        finally
        {
            _writeLock.Release();
        }
    }

    public async Task IncrementRetryAsync(string printJobId, CancellationToken cancellationToken = default)
    {
        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            await using var connection = await OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = "UPDATE print_jobs SET retry_count = retry_count + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE print_job_id = $id;";
            command.Parameters.AddWithValue("$id", printJobId);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        finally
        {
            _writeLock.Release();
        }
    }

    public async Task<PrintJobRecord?> GetJobAsync(string printJobId, CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT * FROM print_jobs WHERE print_job_id = $id;";
        command.Parameters.AddWithValue("$id", printJobId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? Map(reader) : null;
    }

    public async Task<IReadOnlyList<PrintJobRecord>> GetJobsByStatusAsync(
        IEnumerable<string> statuses, CancellationToken cancellationToken = default)
    {
        var statusList = statuses.ToList();
        var placeholders = string.Join(",", statusList.Select((_, i) => $"$s{i}"));

        await using var connection = await OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT * FROM print_jobs WHERE status IN ({placeholders}) ORDER BY created_at ASC;";
        for (var i = 0; i < statusList.Count; i++)
        {
            command.Parameters.AddWithValue($"$s{i}", statusList[i]);
        }

        var results = new List<PrintJobRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            results.Add(Map(reader));
        }
        return results;
    }

    public async Task<IReadOnlyList<PrintJobRecord>> GetRecentJobsAsync(int limit = 100, CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT * FROM print_jobs ORDER BY created_at DESC LIMIT $limit;";
        command.Parameters.AddWithValue("$limit", limit);

        var results = new List<PrintJobRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            results.Add(Map(reader));
        }
        return results;
    }

    // ---------------- local_job_events ----------------

    public async Task InsertEventAsync(string printJobId, string eventType, string? detail, CancellationToken cancellationToken = default)
    {
        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            await using var connection = await OpenAsync(cancellationToken);
            await InsertEventInternalAsync(connection, printJobId, eventType, detail, cancellationToken);
        }
        finally
        {
            _writeLock.Release();
        }
    }

    private static async Task InsertEventInternalAsync(
        SqliteConnection connection, string printJobId, string eventType, string? detail, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO local_job_events (print_job_id, event_type, detail) VALUES ($id, $type, $detail);";
        command.Parameters.AddWithValue("$id", printJobId);
        command.Parameters.AddWithValue("$type", eventType);
        command.Parameters.AddWithValue("$detail", (object?)detail ?? DBNull.Value);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    // ---------------- printer_cache ----------------

    public async Task UpsertPrinterCacheAsync(PrinterCacheRecord printer, CancellationToken cancellationToken = default)
    {
        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            await using var connection = await OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = """
                INSERT INTO printer_cache (printer_name, driver_name, port_name, fingerprint, is_authorized, remote_printer_id, last_seen_at)
                VALUES ($name, $driver, $port, $fingerprint, $auth, $remoteId, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                ON CONFLICT(printer_name) DO UPDATE SET
                    driver_name = excluded.driver_name,
                    port_name = excluded.port_name,
                    fingerprint = excluded.fingerprint,
                    is_authorized = excluded.is_authorized,
                    remote_printer_id = excluded.remote_printer_id,
                    last_seen_at = excluded.last_seen_at;
                """;
            command.Parameters.AddWithValue("$name", printer.PrinterName);
            command.Parameters.AddWithValue("$driver", (object?)printer.DriverName ?? DBNull.Value);
            command.Parameters.AddWithValue("$port", (object?)printer.PortName ?? DBNull.Value);
            command.Parameters.AddWithValue("$fingerprint", (object?)printer.Fingerprint ?? DBNull.Value);
            command.Parameters.AddWithValue("$auth", printer.IsAuthorized ? 1 : 0);
            command.Parameters.AddWithValue("$remoteId", (object?)printer.RemotePrinterId ?? DBNull.Value);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        finally
        {
            _writeLock.Release();
        }
    }

    public async Task<IReadOnlyList<PrinterCacheRecord>> GetCachedPrintersAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT * FROM printer_cache ORDER BY printer_name;";

        var results = new List<PrinterCacheRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            results.Add(new PrinterCacheRecord
            {
                PrinterName = reader.GetString(reader.GetOrdinal("printer_name")),
                DriverName = reader.IsDBNull(reader.GetOrdinal("driver_name")) ? null : reader.GetString(reader.GetOrdinal("driver_name")),
                PortName = reader.IsDBNull(reader.GetOrdinal("port_name")) ? null : reader.GetString(reader.GetOrdinal("port_name")),
                Fingerprint = reader.IsDBNull(reader.GetOrdinal("fingerprint")) ? null : reader.GetString(reader.GetOrdinal("fingerprint")),
                IsAuthorized = reader.GetInt64(reader.GetOrdinal("is_authorized")) == 1,
                RemotePrinterId = reader.IsDBNull(reader.GetOrdinal("remote_printer_id")) ? null : reader.GetString(reader.GetOrdinal("remote_printer_id")),
                LastSeenAt = DateTime.Parse(reader.GetString(reader.GetOrdinal("last_seen_at")), CultureInfo.InvariantCulture)
            });
        }
        return results;
    }

    // ---------------- device_state / settings (simple key-value) ----------------

    public Task<string?> GetDeviceStateAsync(string key, CancellationToken cancellationToken = default) =>
        GetKeyValueAsync("device_state", key, cancellationToken);

    public Task SetDeviceStateAsync(string key, string? value, CancellationToken cancellationToken = default) =>
        SetKeyValueAsync("device_state", key, value, cancellationToken);

    public Task<string?> GetSettingAsync(string key, CancellationToken cancellationToken = default) =>
        GetKeyValueAsync("settings", key, cancellationToken);

    public Task SetSettingAsync(string key, string? value, CancellationToken cancellationToken = default) =>
        SetKeyValueAsync("settings", key, value, cancellationToken);

    public async Task<Dictionary<string, string?>> GetAllSettingsAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT key, value FROM settings;";
        var result = new Dictionary<string, string?>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result[reader.GetString(0)] = reader.IsDBNull(1) ? null : reader.GetString(1);
        }
        return result;
    }

    private async Task<string?> GetKeyValueAsync(string table, string key, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT value FROM {table} WHERE key = $key;";
        command.Parameters.AddWithValue("$key", key);
        var result = await command.ExecuteScalarAsync(cancellationToken);
        return result as string;
    }

    private async Task SetKeyValueAsync(string table, string key, string? value, CancellationToken cancellationToken)
    {
        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            await using var connection = await OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = $"""
                INSERT INTO {table} (key, value, updated_at) VALUES ($key, $value, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
                """;
            command.Parameters.AddWithValue("$key", key);
            command.Parameters.AddWithValue("$value", (object?)value ?? DBNull.Value);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        finally
        {
            _writeLock.Release();
        }
    }

    // ---------------- plumbing ----------------

    private async Task<SqliteConnection> OpenAsync(CancellationToken cancellationToken)
    {
        var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        return connection;
    }

    private static PrintJobRecord Map(SqliteDataReader reader) => new()
    {
        PrintJobId = reader.GetString(reader.GetOrdinal("print_job_id")),
        IdempotencyKey = reader.GetString(reader.GetOrdinal("idempotency_key")),
        PrinterId = reader.GetString(reader.GetOrdinal("printer_id")),
        PrinterName = GetNullableString(reader, "printer_name"),
        StoragePath = reader.GetString(reader.GetOrdinal("storage_path")),
        Status = reader.GetString(reader.GetOrdinal("status")),
        OptionsJson = reader.GetString(reader.GetOrdinal("options_json")),
        LocalFilePath = GetNullableString(reader, "local_file_path"),
        SpoolerJobId = reader.IsDBNull(reader.GetOrdinal("spooler_job_id")) ? null : reader.GetInt32(reader.GetOrdinal("spooler_job_id")),
        RetryCount = reader.GetInt32(reader.GetOrdinal("retry_count")),
        LastError = GetNullableString(reader, "last_error"),
        ClaimedAt = GetNullableDate(reader, "claimed_at"),
        DownloadedAt = GetNullableDate(reader, "downloaded_at"),
        PrintedAt = GetNullableDate(reader, "printed_at"),
        CreatedAt = DateTime.Parse(reader.GetString(reader.GetOrdinal("created_at")), CultureInfo.InvariantCulture),
        UpdatedAt = DateTime.Parse(reader.GetString(reader.GetOrdinal("updated_at")), CultureInfo.InvariantCulture)
    };

    private static string? GetNullableString(SqliteDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
    }

    private static DateTime? GetNullableDate(SqliteDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : DateTime.Parse(reader.GetString(ordinal), CultureInfo.InvariantCulture);
    }
}
