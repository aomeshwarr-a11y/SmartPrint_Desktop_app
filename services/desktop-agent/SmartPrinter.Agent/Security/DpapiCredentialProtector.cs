using System.Security.Cryptography;
using System.Text;

namespace SmartPrinter.Agent.Security;

/// <summary>
/// Encrypts the device credential using Windows Data Protection API (DPAPI), scoped to
/// the local machine (<see cref="DataProtectionScope.LocalMachine"/>) since the Windows
/// Service typically runs under LocalSystem/a service account rather than an interactive
/// user profile. The additional entropy value acts as a second factor tied specifically
/// to this application, so even another LocalSystem process on the same machine cannot
/// trivially decrypt the blob without also knowing the entropy constant compiled into
/// this assembly.
///
/// This is a legitimate, Microsoft-recommended pattern for "secret needs to survive
/// reboots without a master password" on Windows - it is not a substitute for treating
/// the shop PC itself as untrusted (see SECURITY.md); a full local admin compromise can
/// still call DPAPI unprotect as the same account. What it defends against is casual
/// disk/file exfiltration of the credential blob.
/// </summary>
public sealed class DpapiCredentialProtector : ICredentialProtector
{
    // Applies a fixed, application-specific entropy so this blob cannot be unprotected
    // by unrelated DPAPI callers on the same machine/account. This is not a secret key -
    // DPAPI's actual protection comes from the OS-managed master key - it is defense in depth.
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("SmartPrinter.Agent.DeviceCredential.v1");

    public byte[] Protect(string plaintext)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("DPAPI is only available on Windows.");
        }

        var data = Encoding.UTF8.GetBytes(plaintext);
        return ProtectedData.Protect(data, Entropy, DataProtectionScope.LocalMachine);
    }

    public string Unprotect(byte[] ciphertext)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("DPAPI is only available on Windows.");
        }

        var data = ProtectedData.Unprotect(ciphertext, Entropy, DataProtectionScope.LocalMachine);
        return Encoding.UTF8.GetString(data);
    }
}
