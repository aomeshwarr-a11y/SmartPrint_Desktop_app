using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SmartPrinter.Agent.Configuration;

namespace SmartPrinter.Agent.Security;

/// <summary>
/// Machine-level credential issued to a paired Desktop Agent.
/// Stored DPAPI-encrypted on disk. The raw agent token is never stored in Supabase (only its SHA-256 hash)
/// and is never logged in plaintext.
/// </summary>
public sealed record AgentCredential(
    string AgentId,
    string BranchId,
    string AgentToken,
    DateTime IssuedAtUtc)
{
    // Backward-compatible accessors for legacy device/shop references
    [System.Text.Json.Serialization.JsonIgnore]
    public string DeviceId => AgentId;
    [System.Text.Json.Serialization.JsonIgnore]
    public string ShopId => BranchId;
    [System.Text.Json.Serialization.JsonIgnore]
    public string DeviceSecret => AgentToken;
}

// Legacy record for backward compatibility
public sealed record DeviceCredential(
    string DeviceId,
    string ShopId,
    string DeviceSecret,
    DateTime IssuedAtUtc);

/// <summary>
/// Persists the DPAPI-encrypted desktop agent credential file on disk (under the agent's data
/// directory, which is itself ACL'd to Administrators/SYSTEM by the installer) and provides
/// secure deletion when the device is unpaired.
/// </summary>
public sealed class CredentialStore
{
    private readonly ICredentialProtector _protector;
    private readonly string _filePath;
    private readonly ILogger<CredentialStore> _logger;
    private readonly SemaphoreSlim _lock = new(1, 1);

    public CredentialStore(ICredentialProtector protector, IOptions<AgentOptions> options, ILogger<CredentialStore> logger)
    {
        _protector = protector;
        _logger = logger;
        var dataDir = options.Value.ExpandedDataDirectory;
        Directory.CreateDirectory(dataDir);
        _filePath = Path.Combine(dataDir, "device.credential");
    }

    public async Task SaveAsync(AgentCredential credential, CancellationToken cancellationToken = default)
    {
        await _lock.WaitAsync(cancellationToken);
        try
        {
            var dto = new StoredCredentialDto
            {
                AgentId = credential.AgentId,
                BranchId = credential.BranchId,
                AgentToken = credential.AgentToken,
                IssuedAtUtc = credential.IssuedAtUtc
            };
            var json = JsonSerializer.Serialize(dto);
            var encrypted = _protector.Protect(json);
            await File.WriteAllBytesAsync(_filePath, encrypted, cancellationToken);
            _logger.LogInformation("Agent credential saved for agent {AgentId} (token not logged)", credential.AgentId);
        }
        finally
        {
            _lock.Release();
        }
    }

    public Task SaveAsync(DeviceCredential legacy, CancellationToken cancellationToken = default)
    {
        return SaveAsync(new AgentCredential(legacy.DeviceId, legacy.ShopId, legacy.DeviceSecret, legacy.IssuedAtUtc), cancellationToken);
    }

    public async Task<AgentCredential?> LoadAsync(CancellationToken cancellationToken = default)
    {
        if (!File.Exists(_filePath))
        {
            return null;
        }

        await _lock.WaitAsync(cancellationToken);
        try
        {
            var encrypted = await File.ReadAllBytesAsync(_filePath, cancellationToken);
            var json = _protector.Unprotect(encrypted);
            var dto = JsonSerializer.Deserialize<StoredCredentialDto>(json);
            return dto?.ToCredential();
        }
        catch (Exception ex)
        {
            // A credential that fails to decrypt (e.g. the file was copied to a different
            // machine, since DPAPI LocalMachine scope is machine-bound) must never be
            // treated as valid - force re-pairing instead of silently failing open.
            _logger.LogWarning(ex, "Stored desktop agent credential could not be decrypted - treating agent as unpaired");
            return null;
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>
    /// Best-effort secure deletion: overwrite the file's bytes with zeros before deleting,
    /// so the plaintext-adjacent ciphertext does not linger recoverable on disk after unpair.
    /// </summary>
    public async Task DeleteAsync(CancellationToken cancellationToken = default)
    {
        await _lock.WaitAsync(cancellationToken);
        try
        {
            if (!File.Exists(_filePath)) return;

            var length = new FileInfo(_filePath).Length;
            if (length > 0)
            {
                var zeros = new byte[length];
                await File.WriteAllBytesAsync(_filePath, zeros, cancellationToken);
            }

            File.Delete(_filePath);
            _logger.LogInformation("Desktop agent credential deleted (unpaired)");
        }
        finally
        {
            _lock.Release();
        }
    }

    private sealed class StoredCredentialDto
    {
        public string? AgentId { get; set; }
        public string? BranchId { get; set; }
        public string? AgentToken { get; set; }
        public string? DeviceId { get; set; }
        public string? ShopId { get; set; }
        public string? DeviceSecret { get; set; }
        public DateTime IssuedAtUtc { get; set; }

        public AgentCredential ToCredential()
        {
            var agentId = AgentId ?? DeviceId ?? string.Empty;
            var branchId = BranchId ?? ShopId ?? string.Empty;
            var token = AgentToken ?? DeviceSecret ?? string.Empty;
            return new AgentCredential(agentId, branchId, token, IssuedAtUtc);
        }
    }
}
