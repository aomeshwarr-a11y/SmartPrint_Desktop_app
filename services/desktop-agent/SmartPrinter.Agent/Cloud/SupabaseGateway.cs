using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SmartPrinter.Agent.Configuration;
using Supabase;
using Client = Supabase.Client;
using AgentSupabaseOptions = SmartPrinter.Agent.Configuration.SupabaseOptions;

namespace SmartPrinter.Agent.Cloud;

/// <summary>
/// Thin wrapper around the official Supabase C# client (supabase-csharp), scoped to
/// exactly the operations the desktop agent needs. The agent authenticates using the
/// project's public anon key plus a per-device Postgres session set via
/// <see cref="AttachDeviceSessionAsync"/> (a Postgrest header carrying the device's own
/// short-lived JWT - see DeviceAuthService) so that Row Level Security policies scope
/// every query to this device's own shop. The anon key alone grants no access beyond
/// what RLS explicitly allows for an unauthenticated/device-authenticated role.
///
/// service_role is NEVER used or referenced here - see SECURITY.md.
/// </summary>
public sealed class SupabaseGateway
{
    private readonly AgentSupabaseOptions _options;
    private readonly ILogger<SupabaseGateway> _logger;
    private Client? _client;

    public SupabaseGateway(IOptions<AgentSupabaseOptions> options, ILogger<SupabaseGateway> logger)
    {
        _options = options.Value;
        _logger = logger;
    }

    public async Task<Client> GetClientAsync()
    {
        if (_client != null) return _client;

        if (string.IsNullOrWhiteSpace(_options.Url) || string.IsNullOrWhiteSpace(_options.AnonKey))
        {
            throw new InvalidOperationException(
                "Supabase Url/AnonKey are not configured. Set Supabase:Url and Supabase:AnonKey " +
                "in appsettings.json or SMARTPRINTER_Supabase__Url / SMARTPRINTER_Supabase__AnonKey " +
                "environment variables. See docs/SUPABASE-SETUP.md.");
        }

        var supabaseOptions = new Supabase.SupabaseOptions { AutoConnectRealtime = true };
        var client = new Client(_options.Url, _options.AnonKey, supabaseOptions);
        await client.InitializeAsync();
        _client = client;
        _logger.LogInformation("Supabase client initialized against {Url}", _options.Url);
        return _client;
    }

    /// <summary>
    /// Attaches the device's own bearer token (issued during pairing, refreshed
    /// periodically - see DeviceAuthService) so subsequent Postgrest/Realtime calls run
    /// under RLS policies scoped to this device's shop, not as an anonymous caller.
    /// </summary>
    public async Task AttachDeviceSessionAsync(string deviceAccessToken)
    {
        var client = await GetClientAsync();
        // supabase-csharp exposes the underlying Postgrest client's auth header via
        // the Auth module's session; for a device (non-user) principal we set the
        // bearer token directly on the Postgrest client's global headers.
        client.Postgrest.Options.Headers["Authorization"] = $"Bearer {deviceAccessToken}";
    }

    public async Task<byte[]> DownloadFromSignedUrlAsync(string signedUrl, long maxBytes, CancellationToken cancellationToken)
    {
        using var http = new HttpClient();
        using var response = await http.GetAsync(signedUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();

        var declaredLength = response.Content.Headers.ContentLength;
        if (declaredLength.HasValue && declaredLength.Value > maxBytes)
        {
            throw new InvalidOperationException(
                $"File exceeds the configured maximum download size ({declaredLength} > {maxBytes} bytes) - refusing to download.");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var memory = new MemoryStream();
        var buffer = new byte[81920];
        long total = 0;
        int read;
        while ((read = await stream.ReadAsync(buffer, cancellationToken)) > 0)
        {
            total += read;
            if (total > maxBytes)
            {
                throw new InvalidOperationException("File exceeded the maximum allowed download size mid-stream - aborting.");
            }
            await memory.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
        }

        return memory.ToArray();
    }

    public async Task UpdatePrintJobStatusAsync(Guid printJobId, string status, string? error, CancellationToken cancellationToken)
    {
        var client = await GetClientAsync();
        await client.From<CloudPrintJob>()
            .Where(j => j.Id == printJobId)
            .Set(j => j.Status, status)
            .Update(cancellationToken: cancellationToken);

        await client.From<CloudPrintJobEvent>().Insert(new CloudPrintJobEvent
        {
            Id = Guid.NewGuid(),
            PrintJobId = printJobId,
            EventType = $"status:{status}",
            DetailJson = error,
            CreatedAt = DateTime.UtcNow
        }, cancellationToken: cancellationToken);
    }

    public async Task<IReadOnlyList<CloudPrintJob>> CatchUpQueuedJobsAsync(Guid deviceId, CancellationToken cancellationToken)
    {
        var client = await GetClientAsync();
        var response = await client.From<CloudPrintJob>()
            .Where(j => j.DeviceId == deviceId)
            .Where(j => j.Status == "queued")
            .Get(cancellationToken);
        return response.Models;
    }

    public async Task UpdateDeviceLastSeenAsync(Guid deviceId, CancellationToken cancellationToken)
    {
        var client = await GetClientAsync();
        await client.From<CloudDevice>()
            .Where(d => d.Id == deviceId)
            .Set(d => d.LastSeenAt, DateTime.UtcNow)
            .Update(cancellationToken: cancellationToken);
    }
}
