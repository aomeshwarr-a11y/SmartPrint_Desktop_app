namespace SmartPrinter.Agent.Configuration;

/// <summary>
/// Strongly typed configuration bound from the "Agent" section of appsettings.json.
/// Environment variables prefixed SMARTPRINTER_Agent__* override these at runtime,
/// which is how production deployments should inject machine-specific paths without
/// editing the shipped appsettings.json.
/// </summary>
public sealed class AgentOptions
{
    /// <summary>Root folder for SQLite DB, logs, and credential blobs. Supports %ENVVAR% expansion.</summary>
    public string DataDirectory { get; set; } = "%PROGRAMDATA%\\SmartPrinter\\Agent";

    /// <summary>Local named pipe name (without the \\.\pipe\ prefix) used for Electron IPC.</summary>
    public string PipeName { get; set; } = "SmartPrinterAgentPipe";

    /// <summary>How often to push a lightweight "last seen" update when otherwise idle.</summary>
    public int LastSeenIntervalSeconds { get; set; } = 300;

    public int RealtimeReconnectMinBackoffSeconds { get; set; } = 1;

    public int RealtimeReconnectMaxBackoffSeconds { get; set; } = 60;

    public int JobDownloadTimeoutSeconds { get; set; } = 60;

    public int JobRetryLimit { get; set; } = 3;

    public string TempFileDirectory { get; set; } = "%PROGRAMDATA%\\SmartPrinter\\Agent\\temp";

    /// <summary>Hard cap on downloaded file size to prevent resource-exhaustion attacks via a malicious/huge upload.</summary>
    public long MaxDownloadFileSizeBytes { get; set; } = 50 * 1024 * 1024;

    /// <summary>Only these extensions will ever be downloaded or printed. Defense-in-depth against unexpected file types.</summary>
    public string[] AllowedFileExtensions { get; set; } = { ".pdf" };

    /// <summary>
    /// When true, SupabaseGateway and RealtimeJobListener are replaced with in-memory mocks
    /// that simulate cloud behavior locally. Printer discovery/printing is NEVER mocked -
    /// this only mocks the cloud dependency so the printing pipeline can be exercised without
    /// real Supabase credentials. See docs/DEVELOPMENT.md.
    /// </summary>
    public bool MockCloudMode { get; set; }

    public string ExpandedDataDirectory => Environment.ExpandEnvironmentVariables(DataDirectory);

    public string ExpandedTempFileDirectory => Environment.ExpandEnvironmentVariables(TempFileDirectory);
}
