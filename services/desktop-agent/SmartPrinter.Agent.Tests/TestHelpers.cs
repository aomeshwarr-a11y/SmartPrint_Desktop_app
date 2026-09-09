using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using SmartPrinter.Agent.Configuration;
using SmartPrinter.Agent.Data;

namespace SmartPrinter.Agent.Tests;

internal static class TestHelpers
{
    /// <summary>
    /// Creates a SqliteQueueRepository backed by a fresh temp-directory database per test,
    /// so tests never share or corrupt state between runs. Caller is responsible for
    /// deleting the returned directory if desired (xUnit temp dirs are left for CI log
    /// inspection on failure, which is intentional).
    /// </summary>
    public static async Task<(SqliteQueueRepository Repo, string DataDir)> CreateRepositoryAsync()
    {
        var dataDir = Path.Combine(Path.GetTempPath(), "smartprinter-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dataDir);

        var options = Options.Create(new AgentOptions { DataDirectory = dataDir });
        var repo = new SqliteQueueRepository(options, NullLogger<SqliteQueueRepository>.Instance);
        await repo.InitializeAsync();
        return (repo, dataDir);
    }
}
