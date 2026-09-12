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
    private TaskCompletionSource<bool> _pairingTcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private TaskCompletionSource<bool> _unpairTcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly object _signalLock = new();

    public void NotifyPairingCompleted()
    {
        lock (_signalLock)
        {
            _pairingTcs.TrySetResult(true);
            _pairingTcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
        }
    }

    public async Task WaitForPairingAsync(CancellationToken cancellationToken)
    {
        Task task;
        lock (_signalLock)
        {
            task = _pairingTcs.Task;
        }
        try
        {
            await task.WaitAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            // Expected on service shutdown
        }
    }

    public void NotifyUnpaired()
    {
        lock (_signalLock)
        {
            _unpairTcs.TrySetResult(true);
            _unpairTcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
        }
    }

    public async Task WaitForUnpairAsync(CancellationToken cancellationToken)
    {
        Task task;
        lock (_signalLock)
        {
            task = _unpairTcs.Task;
        }
        try
        {
            await task.WaitAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            // Expected on service shutdown
        }
    }

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

        NotifyPairingCompleted();

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

        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await response.Content.ReadAsStringAsync(cancellationToken);
            _logger.LogWarning("Token refresh failed: Status={StatusCode}, DeviceId={DeviceId}, Response={Response}",
                (int)response.StatusCode, _cachedCredential.DeviceId, errorBody);

            // ONLY unpair if the backend Edge Function definitively rejected the device/credential as revoked or non-existent
            // (e.g. 401 "Invalid or revoked device credential.", or 403 "Device not found or not active.").
            // Do NOT unpair on gateway errors (e.g. UNAUTHORIZED_NO_AUTH_HEADER), rate limits, 500s, or transient network issues.
            bool isDefinitivelyRevoked = false;
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(errorBody);
                if (doc.RootElement.TryGetProperty("error", out var errProp))
                {
                    var errMsg = errProp.GetString();
                    if (errMsg != null && (
                        errMsg.Contains("revoked", StringComparison.OrdinalIgnoreCase) ||
                        errMsg.Contains("not found", StringComparison.OrdinalIgnoreCase) ||
                        errMsg.Contains("not active", StringComparison.OrdinalIgnoreCase)))
                    {
                        isDefinitivelyRevoked = true;
                    }
                }
            }
            catch
            {
                // Not valid JSON from Edge Function; treat as non-revocation error
            }

            if (isDefinitivelyRevoked)
            {
                _logger.LogWarning("Device credential was definitively rejected by backend ({ErrorBody}) - clearing local credential", errorBody);
                await UnpairAsync(cancellationToken);
                throw new InvalidOperationException($"Device credential revoked. Re-pairing is required. (Backend error: {errorBody})");
            }

            throw new InvalidOperationException($"Failed to refresh device token (Status {(int)response.StatusCode}): {errorBody}");
        }

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
                var response = await http.PostAsJsonAsync("device-revoke", new
                {
                    device_id = _cachedCredential.DeviceId,
                    device_secret = _cachedCredential.DeviceSecret
                }, cancellationToken);

                if (response.IsSuccessStatusCode)
                {
                    _logger.LogInformation("Backend device revocation acknowledged for device {DeviceId}", _cachedCredential.DeviceId);
                }
                else
                {
                    var err = await response.Content.ReadAsStringAsync(cancellationToken);
                    _logger.LogWarning("Backend device revocation returned status {StatusCode}: {Error}", (int)response.StatusCode, err);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to notify backend of unpair (will still clear local credential)");
            }
        }

        await _credentialStore.DeleteAsync(cancellationToken);
        _cachedCredential = null;
        NotifyUnpaired();
    }

    private HttpClient BuildFunctionsClient(string? ownerAccessToken)
    {
        var http = _httpClientFactory.CreateClient();
        http.BaseAddress = new Uri($"{_supabaseOptions.Url.TrimEnd('/')}/functions/v1/");
        http.DefaultRequestHeaders.Add("apikey", _supabaseOptions.AnonKey);

        // Supabase Edge Function API Gateway (Kong) requires an Authorization header on all requests.
        // If an owner token is available (e.g. device-pairing-create), use it.
        // Otherwise (e.g. device-pairing-confirm, device-token-refresh, device-revoke),
        // pass the anon key as the Bearer token so the gateway accepts the request.
        var bearerToken = !string.IsNullOrEmpty(ownerAccessToken) ? ownerAccessToken : _supabaseOptions.AnonKey;
        http.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", bearerToken);
        return http;
    }

    // ReSharper disable InconsistentNaming — these mirror the Edge Functions' JSON field names exactly.
    private sealed record PairingCreateResponse(string pairing_code, DateTime expires_at);
    private sealed record PairingConfirmResponse(string device_id, string shop_id, string device_secret);
    private sealed record TokenRefreshResponse(string access_token, int expires_in);
}
