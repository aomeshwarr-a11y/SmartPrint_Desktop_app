using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SmartPrinter.Agent.Configuration;

namespace SmartPrinter.Agent.Security;

public sealed record DeviceCredential(
    string DeviceId,
    string ShopId,
    string DeviceSecret,
    DateTime IssuedAtUtc);

/// <summary>
/// Persists the DPAPI-encrypted device credential file on disk (under the agent's data
/// directory, which is itself ACL'd to Administrators/SYSTEM by the installer - see
/// installer/README.md) and provides secure deletion when the device is unpaired.
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

    public async Task SaveAsync(DeviceCredential credential, CancellationToken cancellationToken = default)
    {
        await _lock.WaitAsync(cancellationToken);
        try
        {
            var json = JsonSerializer.Serialize(credential);
            var encrypted = _protector.Protect(json);
            await File.WriteAllBytesAsync(_filePath, encrypted, cancellationToken);
            _logger.LogInformation("Device credential saved for device {DeviceId} (secret not logged)", credential.DeviceId);
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<DeviceCredential?> LoadAsync(CancellationToken cancellationToken = default)
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
            return JsonSerializer.Deserialize<DeviceCredential>(json);
        }
        catch (Exception ex)
        {
            // A credential that fails to decrypt (e.g. the file was copied to a different
            // machine, since DPAPI LocalMachine scope is machine-bound) must never be
            // treated as valid - force re-pairing instead of silently failing open.
            _logger.LogWarning(ex, "Stored device credential could not be decrypted - treating device as unpaired");
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
    /// This is a mitigation, not a forensic guarantee (SSD wear-leveling can retain copies
    /// regardless) - documented honestly in SECURITY.md.
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
            _logger.LogInformation("Device credential deleted (unpaired)");
        }
        finally
        {
            _lock.Release();
        }
    }
}
