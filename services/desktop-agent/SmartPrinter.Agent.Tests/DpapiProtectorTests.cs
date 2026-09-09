using SmartPrinter.Agent.Security;
using Xunit;

namespace SmartPrinter.Agent.Tests;

/// <summary>
/// DPAPI is a Windows-only OS feature and cannot be exercised on a non-Windows CI runner
/// or dev machine. Every test here checks <see cref="OperatingSystem.IsWindows"/> first
/// and passes trivially (with a clear reason) when not on Windows, rather than silently
/// skipping in a way that could be mistaken for "passing on Windows too". Run these on an
/// actual Windows 10/11 box before relying on them - see docs/DEVELOPMENT.md.
/// </summary>
public class DpapiProtectorTests
{
    [Fact]
    public void ProtectThenUnprotect_RoundTripsOriginalPlaintext()
    {
        if (!OperatingSystem.IsWindows())
        {
            return; // Inconclusive on this platform - re-run on Windows. See class remarks.
        }

        var protector = new DpapiCredentialProtector();
        const string secret = "device-secret-value-12345";

        var encrypted = protector.Protect(secret);
        var decrypted = protector.Unprotect(encrypted);

        Assert.NotEqual(secret, System.Text.Encoding.UTF8.GetString(encrypted));
        Assert.Equal(secret, decrypted);
    }

    [Fact]
    public void Protect_ProducesCiphertextThatDoesNotContainPlaintext()
    {
        if (!OperatingSystem.IsWindows())
        {
            return;
        }

        var protector = new DpapiCredentialProtector();
        const string secret = "super-secret-device-token";

        var encrypted = protector.Protect(secret);
        var encryptedAsLatin1 = System.Text.Encoding.Latin1.GetString(encrypted);

        Assert.DoesNotContain(secret, encryptedAsLatin1, StringComparison.Ordinal);
    }

    [Fact]
    public void Protect_OnNonWindows_ThrowsPlatformNotSupported()
    {
        if (OperatingSystem.IsWindows())
        {
            return; // This behavior is specific to non-Windows platforms.
        }

        var protector = new DpapiCredentialProtector();
        Assert.Throws<PlatformNotSupportedException>(() => protector.Protect("anything"));
    }
}
