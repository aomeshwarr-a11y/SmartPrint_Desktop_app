using System.Net.Http.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SmartPrinter.Agent.Configuration;
using SmartPrinter.Agent.Security;

namespace SmartPrinter.Agent.Cloud;

public sealed record PairingRequestResult(string PairingCode, DateTime ExpiresAtUtc);

public sealed record PairingConfirmationResult(string DeviceId, string ShopId, string DeviceSecret);

/// <summary>
/// Implements the device pairing flow from ARCHITECTURE.md §8, talking to the
/// `device-pairing-create` / `device-pairing-confirm` Edge Functions (see
/// supabase/functions/). The device never authenticates as the shop owner - it only ever
/// holds the narrow device credential minted at the end of this flow, stored via
/// <see cref="CredentialStore"/> (DPAPI-encrypted).
/// </summary>
public sealed class DeviceAuthService
{
    private readonly SupabaseOptions _supabaseOptions;
    private readonly CredentialStore _credentialStore;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<DeviceAuthService> _logger;

    public DeviceAuthService(
        IOptions<SupabaseOptions> supabaseOptions,
        CredentialStore credentialStore,
        IHttpClientFactory httpClientFactory,
        ILogger<DeviceAuthService> logger)
    {
        _supabaseOptions = supabaseOptions.Value;
        _credentialStore = credentialStore;
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    public bool IsPaired => _cachedCredential != null;

    private DeviceCredential? _cachedCredential;

    public async Task<DeviceCredential?> LoadStoredCredentialAsync(CancellationToken cancellationToken = default)
    {
        _cachedCredential = await _credentialStore.LoadAsync(cancellationToken);
        return _cachedCredential;
    }

    /// <summary>
    /// Step 1: ask the backend to create a pairing request for the shop the owner is
    /// currently authenticated as (ownerAccessToken is the owner's own Supabase Auth
    /// session token, obtained by the Electron UI's normal login flow and passed to the
    /// agent over the local named pipe - it is never persisted by the agent).
    /// </summary>
    public async Task<PairingRequestResult> CreatePairingRequestAsync(string ownerAccessToken, CancellationToken cancellationToken = default)
    {
        var http = BuildFunctionsClient(ownerAccessToken);
        var response = await http.PostAsJsonAsync("device-pairing-create", new { }, cancellationToken);
        response.EnsureSuccessStatusCode();
        var payload = await response.Content.ReadFromJsonAsync<PairingCreateResponse>(cancellationToken: cancellationToken)
                      ?? throw new InvalidOperationException("Empty response from device-pairing-create.");

        return new PairingRequestResult(payload.pairing_code, payload.expires_at);
    }

    /// <summary>
    /// Step 2: once the owner has confirmed the pairing code in the UI, exchange it for
    /// permanent device credentials and persist them via DPAPI.
    /// </summary>
    public async Task<PairingConfirmationResult> ConfirmPairingAsync(string pairingCode, CancellationToken cancellationToken = default)
    {
        var http = BuildFunctionsClient(null);
        var response = await http.PostAsJsonAsync("device-pairing-confirm", new { pairing_code = pairingCode }, cancellationToken);
        response.EnsureSuccessStatusCode();
        var payload = await response.Content.ReadFromJsonAsync<PairingConfirmResponse>(cancellationToken: cancellationToken)
                      ?? throw new InvalidOperationException("Empty response from device-pairing-confirm.");

        var credential = new DeviceCredential(payload.device_id, payload.shop_id, payload.device_secret, DateTime.UtcNow);
        await _credentialStore.SaveAsync(credential, cancellationToken);
        _cachedCredential = credential;

        _logger.LogInformation("Device paired successfully. DeviceId={DeviceId}", payload.device_id);
        return new PairingConfirmationResult(payload.device_id, payload.shop_id, payload.device_secret);
    }

    /// <summary>
    /// Exchanges the long-lived device secret for a short-lived access token used for
    /// Postgrest/Realtime auth (see SupabaseGateway.AttachDeviceSessionAsync). Called on
    /// startup and periodically before the previous token expires.
    /// </summary>
    public async Task<string> RefreshAccessTokenAsync(CancellationToken cancellationToken = default)
    {
        if (_cachedCredential == null)
        {
            throw new InvalidOperationException("Device is not paired - cannot refresh access token.");
        }

        var http = BuildFunctionsClient(null);
        var response = await http.PostAsJsonAsync("device-token-refresh", new
        {
            device_id = _cachedCredential.DeviceId,
            device_secret = _cachedCredential.DeviceSecret
        }, cancellationToken);

        if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized || response.StatusCode == System.Net.HttpStatusCode.Forbidden)
        {
            _logger.LogWarning("Device credential was rejected by backend (revoked?) - clearing local credential");
            await UnpairAsync(cancellationToken);
            throw new InvalidOperationException("Device credential revoked. Re-pairing is required.");
        }

        response.EnsureSuccessStatusCode();
        var payload = await response.Content.ReadFromJsonAsync<TokenRefreshResponse>(cancellationToken: cancellationToken)
                      ?? throw new InvalidOperationException("Empty response from device-token-refresh.");
        return payload.access_token;
    }

    public async Task UnpairAsync(CancellationToken cancellationToken = default)
    {
        if (_cachedCredential != null)
        {
            try
            {
                var http = BuildFunctionsClient(null);
                await http.PostAsJsonAsync("device-revoke", new
                {
                    device_id = _cachedCredential.DeviceId,
                    device_secret = _cachedCredential.DeviceSecret
                }, cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to notify backend of unpair (will still clear local credential)");
            }
        }

        await _credentialStore.DeleteAsync(cancellationToken);
        _cachedCredential = null;
    }

    private HttpClient BuildFunctionsClient(string? ownerAccessToken)
    {
        var http = _httpClientFactory.CreateClient();
        http.BaseAddress = new Uri($"{_supabaseOptions.Url.TrimEnd('/')}/functions/v1/");
        http.DefaultRequestHeaders.Add("apikey", _supabaseOptions.AnonKey);
        if (!string.IsNullOrEmpty(ownerAccessToken))
        {
            http.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", ownerAccessToken);
        }
        return http;
    }

    // ReSharper disable InconsistentNaming — these mirror the Edge Functions' JSON field names exactly.
    private sealed record PairingCreateResponse(string pairing_code, DateTime expires_at);
    private sealed record PairingConfirmResponse(string device_id, string shop_id, string device_secret);
    private sealed record TokenRefreshResponse(string access_token, int expires_in);
}
