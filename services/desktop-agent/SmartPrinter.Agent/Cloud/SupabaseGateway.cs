using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SmartPrinter.Agent.Configuration;
using Supabase;
using Client = Supabase.Client;
using AgentSupabaseOptions = SmartPrinter.Agent.Configuration.SupabaseOptions;

namespace SmartPrinter.Agent.Cloud;

/// <summary>
/// Thin wrapper around the official Supabase C# client (supabase-csharp).
/// The desktop agent authenticates using the project's public anon key plus
/// the short-lived agent JWT returned by the pairing/authentication flow.
/// </summary>
public sealed class SupabaseGateway
{
    private readonly AgentSupabaseOptions _options;
    private readonly ILogger<SupabaseGateway> _logger;

    private Client? _client;

    public string? CurrentAccessToken { get; private set; }

    public SupabaseGateway(
        IOptions<AgentSupabaseOptions> options,
        ILogger<SupabaseGateway> logger)
    {
        _options = options.Value;
        _logger = logger;
    }

    /// <summary>
    /// Creates and initializes the Supabase client.
    ///
    /// Realtime auto-connect is deliberately disabled here.
    /// The agent JWT must be attached before Realtime connects.
    /// </summary>
    public async Task<Client> GetClientAsync()
    {
        if (_client != null)
            return _client;

        if (string.IsNullOrWhiteSpace(_options.Url) ||
            string.IsNullOrWhiteSpace(_options.AnonKey))
        {
            throw new InvalidOperationException(
                "Supabase Url/AnonKey are not configured. Set Supabase:Url and Supabase:AnonKey " +
                "in appsettings.json or SMARTPRINTER_Supabase__Url / SMARTPRINTER_Supabase__AnonKey " +
                "environment variables. See docs/SUPABASE-SETUP.md.");
        }

        // IMPORTANT:
        // Do NOT allow Realtime to connect during InitializeAsync().
        // The agent JWT is attached later in AttachDeviceSessionAsync().
        var supabaseOptions = new Supabase.SupabaseOptions
        {
            AutoConnectRealtime = false
        };

        var client = new Client(
            _options.Url,
            _options.AnonKey,
            supabaseOptions);

        await client.InitializeAsync();

        _client = client;

        _logger.LogInformation(
            "Supabase client initialized against {Url}",
            _options.Url);

        return _client;
    }

    /// <summary>
    /// Attaches the desktop agent's short-lived Supabase JWT to:
    /// - PostgREST
    /// - Realtime
    /// - Storage
    ///
    /// Realtime is connected only AFTER SetAuth() so the WebSocket
    /// handshake contains the authenticated agent JWT.
    /// </summary>
    public async Task AttachDeviceSessionAsync(string agentAccessToken)
    {
        if (string.IsNullOrWhiteSpace(agentAccessToken))
        {
            throw new ArgumentException(
                "Agent access token cannot be empty.",
                nameof(agentAccessToken));
        }

        CurrentAccessToken = agentAccessToken;

        var client = await GetClientAsync();

        // PostgreSQL/PostgREST authentication
        client.Postgrest.Options.Headers["Authorization"] =
            $"Bearer {agentAccessToken}";

        // Realtime authentication
        client.Realtime.SetAuth(agentAccessToken);

        // Realtime WebSocket handshake parameters
        client.Realtime.Options.Parameters.ApiKey = _options.AnonKey;
        client.Realtime.Options.Parameters.Token = agentAccessToken;

        // Storage authentication
        client.Storage.Headers["Authorization"] =
            $"Bearer {agentAccessToken}";

        _logger.LogInformation(
            "Supabase agent session attached. Realtime authentication configured.");

        // IMPORTANT:
        // Connect Realtime only AFTER the JWT has been configured.
        await client.Realtime.ConnectAsync();

        _logger.LogInformation(
            "Supabase Realtime connected successfully.");
    }

    /// <summary>
    /// Downloads a file from an already-generated signed URL.
    /// </summary>
    public async Task<byte[]> DownloadFromSignedUrlAsync(
        string signedUrl,
        long maxBytes,
        CancellationToken cancellationToken)
    {
        using var http = new HttpClient();

        using var response = await http.GetAsync(
            signedUrl,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);

        response.EnsureSuccessStatusCode();

        var declaredLength = response.Content.Headers.ContentLength;

        if (declaredLength.HasValue && declaredLength.Value > maxBytes)
        {
            throw new InvalidOperationException(
                $"File exceeds the configured maximum download size " +
                $"({declaredLength} > {maxBytes} bytes) - refusing to download.");
        }

        await using var stream =
            await response.Content.ReadAsStreamAsync(cancellationToken);

        await using var memory = new MemoryStream();

        var buffer = new byte[81920];

        long total = 0;
        int read;

        while ((read = await stream.ReadAsync(
                   buffer,
                   cancellationToken)) > 0)
        {
            total += read;

            if (total > maxBytes)
            {
                throw new InvalidOperationException(
                    "File exceeded the maximum allowed download size " +
                    "mid-stream - aborting.");
            }

            await memory.WriteAsync(
                buffer.AsMemory(0, read),
                cancellationToken);
        }

        return memory.ToArray();
    }

    /// <summary>
    /// Creates a signed URL for a file stored in the configured bucket.
    /// </summary>
    public async Task<string> CreateSignedUrlAsync(
        string storagePath,
        int expiresInSeconds = 600)
    {
        var client = await GetClientAsync();

        return await client.Storage
            .From(_options.StorageBucket)
            .CreateSignedUrl(
                storagePath,
                expiresInSeconds);
    }

    /// <summary>
    /// Updates the print job status.
    /// Production database status values are mapped here to the
    /// values expected by the print_jobs status constraint.
    /// </summary>
    public async Task UpdatePrintJobStatusAsync(
        Guid printJobId,
        string status,
        string? error,
        CancellationToken cancellationToken)
    {
        var client = await GetClientAsync();

        var dbStatus = status switch
        {
            "claimed" => "processing",
            "downloaded" => "processing",
            "printing" => "printing",
            "completed" => "completed",
            "done" => "completed",
            "failed" => "failed",
            "cancelled" => "failed",
            _ => status
        };

        await client
            .From<CloudPrintJob>()
            .Where(j => j.Id == printJobId)
            .Set(j => j.Status, dbStatus)
            .Update(cancellationToken: cancellationToken);
    }

    /// <summary>
    /// Retrieves queued jobs assigned to this desktop agent.
    /// RLS on the production database is responsible for limiting
    /// which jobs the authenticated agent can see.
    /// </summary>
    public async Task<IReadOnlyList<CloudPrintJob>> CatchUpQueuedJobsAsync(
        Guid agentId,
        CancellationToken cancellationToken)
    {
        var client = await GetClientAsync();

        var response = await client
            .From<CloudPrintJob>()
            .Where(j => j.Status == "queued")
            .Get(cancellationToken);

        return response.Models;
    }

    /// <summary>
    /// Updates the desktop agent's last_seen_at timestamp.
    /// </summary>
    public async Task UpdateDeviceLastSeenAsync(
        Guid agentId,
        CancellationToken cancellationToken)
    {
        var client = await GetClientAsync();

        await client
            .From<CloudDesktopAgent>()
            .Where(d => d.Id == agentId)
            .Set(d => d.LastSeenAt!, DateTime.UtcNow)
            .Update(cancellationToken: cancellationToken);
    }

    public Task UpdateAgentLastSeenAsync(
        Guid agentId,
        CancellationToken cancellationToken)
    {
        return UpdateDeviceLastSeenAsync(
            agentId,
            cancellationToken);
    }
}

