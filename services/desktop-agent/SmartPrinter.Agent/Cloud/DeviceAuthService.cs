using System.Net.Http.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SmartPrinter.Agent.Configuration;
using SmartPrinter.Agent.Security;

namespace SmartPrinter.Agent.Cloud;

public sealed record PairingRequestResult(string PairingCode, DateTime ExpiresAtUtc);

public sealed record PairingConfirmationResult(string AgentId, string BranchId, string AgentToken)
{
    // Backward-compatible accessors
    public string DeviceId => AgentId;
    public string ShopId => BranchId;
    public string DeviceSecret => AgentToken;
}

/// <summary>
/// Implements the desktop agent pairing and authentication flow, communicating with the
/// `device-pairing-create`, `device-pairing-confirm`, `device-token-refresh`, and `device-revoke`
/// Supabase Edge Functions. The agent never holds user credentials — it manages a machine-level
/// opaque bearer token stored via <see cref="CredentialStore"/> (DPAPI-encrypted).
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
    public AgentCredential? CachedCredential => _cachedCredential;
    public TimeSpan RecommendedRefreshInterval { get; private set; } = TimeSpan.FromMinutes(10);

    private AgentCredential? _cachedCredential;
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

    public async Task<AgentCredential?> LoadStoredCredentialAsync(CancellationToken cancellationToken = default)
    {
        _cachedCredential = await _credentialStore.LoadAsync(cancellationToken);
        return _cachedCredential;
    }

    /// <summary>
    /// Step 1: Forward the authenticated branch user's access token to device-pairing-create
    /// to mint a short-lived, single-use 6-digit pairing code. The ownerAccessToken is never persisted.
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
    /// Step 2: Exchange the 6-digit pairing code for permanent machine credentials.
    /// The Edge Function hashes the raw token in desktop_agent_tokens and returns the raw token
    /// exactly once. The raw token is immediately DPAPI-encrypted to disk and never logged in plaintext.
    /// </summary>
    public async Task<PairingConfirmationResult> ConfirmPairingAsync(string pairingCode, CancellationToken cancellationToken = default)
    {
        var http = BuildFunctionsClient(null);

        var requestBody = new
        {
            pairing_code = pairingCode,
            agent_name = "Desktop Agent",
            hostname = Environment.MachineName,
            os_version = Environment.OSVersion.ToString(),
            app_version = typeof(DeviceAuthService).Assembly.GetName().Version?.ToString() ?? "2.4.1"
        };

        var response = await http.PostAsJsonAsync("device-pairing-confirm", requestBody, cancellationToken);
        response.EnsureSuccessStatusCode();
        var payload = await response.Content.ReadFromJsonAsync<PairingConfirmResponse>(cancellationToken: cancellationToken)
                      ?? throw new InvalidOperationException("Empty response from device-pairing-confirm.");

        var agentId = payload.desktop_agent_id ?? payload.device_id ?? throw new InvalidOperationException("Missing desktop_agent_id in response.");
        var branchId = payload.branch_id ?? payload.shop_id ?? throw new InvalidOperationException("Missing branch_id in response.");
        var rawToken = payload.agent_token ?? payload.device_secret ?? throw new InvalidOperationException("Missing agent_token in response.");

        var credential = new AgentCredential(agentId, branchId, rawToken, DateTime.UtcNow);
        await _credentialStore.SaveAsync(credential, cancellationToken);
        _cachedCredential = credential;

        if (payload.expires_in.HasValue && payload.expires_in.Value > 60)
        {
            RecommendedRefreshInterval = TimeSpan.FromSeconds(Math.Max(30, payload.expires_in.Value - 120));
        }

        NotifyPairingCompleted();

        _logger.LogInformation("Desktop agent paired successfully. AgentId={AgentId}, BranchId={BranchId}", agentId, branchId);
        return new PairingConfirmationResult(agentId, branchId, rawToken);
    }

    /// <summary>
    /// Refreshes the desktop agent token using the new opaque bearer token architecture.
    /// Sends `Authorization: Bearer <current_agent_token>`. The backend revokes the previous token,
    /// stores the new token hash, and returns the new raw token.
    /// </summary>
    public async Task<string> RefreshAccessTokenAsync(CancellationToken cancellationToken = default)
    {
        if (_cachedCredential == null)
        {
            throw new InvalidOperationException("Device is not paired - cannot refresh access token.");
        }

        var http = BuildFunctionsClient(_cachedCredential.AgentToken);
        var response = await http.PostAsJsonAsync("device-token-refresh", new
        {
            desktop_agent_id = _cachedCredential.AgentId,
            agent_token = _cachedCredential.AgentToken
        }, cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await response.Content.ReadAsStringAsync(cancellationToken);
            _logger.LogWarning("Token refresh failed: Status={StatusCode}, AgentId={AgentId}, Response={Response}",
                (int)response.StatusCode, _cachedCredential.AgentId, errorBody);

            // ONLY unpair if the backend Edge Function definitively rejected the credential as revoked or non-existent
            // (e.g. 401 "Invalid or revoked device credential.", or 403 "Desktop agent is revoked.").
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
                        errMsg.Contains("not active", StringComparison.OrdinalIgnoreCase) ||
                        errMsg.Contains("expired", StringComparison.OrdinalIgnoreCase) ||
                        errMsg.Contains("Invalid agent token", StringComparison.OrdinalIgnoreCase)))
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
                _logger.LogWarning("Desktop agent credential was definitively rejected by backend ({ErrorBody}) - clearing local credential", errorBody);
                await UnpairAsync(cancellationToken);
                throw new InvalidOperationException($"Device credential revoked. Re-pairing is required. (Backend error: {errorBody})");
            }

            throw new InvalidOperationException($"Failed to refresh device token (Status {(int)response.StatusCode}): {errorBody}");
        }

        var payload = await response.Content.ReadFromJsonAsync<TokenRefreshResponse>(cancellationToken: cancellationToken)
                      ?? throw new InvalidOperationException("Empty response from device-token-refresh.");

        // 1. If backend rotated the agent_token (machine credential), persist it in DPAPI
        if (!string.IsNullOrEmpty(payload.agent_token) && payload.agent_token != _cachedCredential.AgentToken)
        {
            var updatedCredential = _cachedCredential with
            {
                AgentToken = payload.agent_token,
                IssuedAtUtc = DateTime.UtcNow
            };
            await _credentialStore.SaveAsync(updatedCredential, cancellationToken);
            _cachedCredential = updatedCredential;
            _logger.LogInformation("Agent refresh credential rotated and stored securely for agent {AgentId}", _cachedCredential.AgentId);
        }

        // 2. Track refresh interval based on expires_in if provided
        if (payload.expires_in.HasValue && payload.expires_in.Value > 60)
        {
            RecommendedRefreshInterval = TimeSpan.FromSeconds(Math.Max(30, payload.expires_in.Value - 120));
        }

        // 3. Return the Supabase JWT access token for PostgREST & Realtime
        var jwt = payload.access_token ?? payload.agent_token
                  ?? throw new InvalidOperationException("Missing access_token in refresh response.");

        _logger.LogInformation("Agent access token (JWT) refreshed successfully for agent {AgentId}", _cachedCredential.AgentId);
        return jwt;
    }

    /// <summary>
    /// Unpairs the desktop agent by notifying device-revoke and securely deleting local DPAPI credentials.
    /// </summary>
    public async Task UnpairAsync(CancellationToken cancellationToken = default)
    {
        if (_cachedCredential != null)
        {
            try
            {
                var http = BuildFunctionsClient(_cachedCredential.AgentToken);
                var response = await http.PostAsJsonAsync("device-revoke", new
                {
                    desktop_agent_id = _cachedCredential.AgentId,
                    agent_token = _cachedCredential.AgentToken
                }, cancellationToken);

                if (response.IsSuccessStatusCode)
                {
                    _logger.LogInformation("Backend agent revocation acknowledged for agent {AgentId}", _cachedCredential.AgentId);
                }
                else
                {
                    var err = await response.Content.ReadAsStringAsync(cancellationToken);
                    _logger.LogWarning("Backend agent revocation returned status {StatusCode}: {Error}", (int)response.StatusCode, err);
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

    private HttpClient BuildFunctionsClient(string? bearerToken)
    {
        var http = _httpClientFactory.CreateClient();
        http.BaseAddress = new Uri($"{_supabaseOptions.Url.TrimEnd('/')}/functions/v1/");
        http.DefaultRequestHeaders.Add("apikey", _supabaseOptions.AnonKey);

        // Supabase Edge Function Gateway expects Authorization header.
        // If a specific bearer token (user session or agent token) is available, use it.
        // Otherwise, supply anon key so Kong accepts public endpoints.
        var token = !string.IsNullOrEmpty(bearerToken) ? bearerToken : _supabaseOptions.AnonKey;
        http.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        return http;
    }

    private sealed record PairingCreateResponse(string pairing_code, DateTime expires_at);

    private sealed record PairingConfirmResponse(
        string? desktop_agent_id,
        string? branch_id,
        string? agent_token,
        string? access_token,
        int? expires_in,
        string? device_id,
        string? shop_id,
        string? device_secret,
        DateTime? expires_at);

    private sealed record TokenRefreshResponse(
        string? desktop_agent_id,
        string? branch_id,
        string? agent_token,
        string? access_token,
        int? expires_in,
        DateTime? expires_at);
}
