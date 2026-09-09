namespace SmartPrinter.Agent.Security;

/// <summary>
/// Abstraction over platform credential encryption, so business logic never touches
/// DPAPI directly and so it can be substituted with a fake in unit tests (DPAPI itself
/// only works on Windows and cannot be exercised in a non-Windows test runner).
/// </summary>
public interface ICredentialProtector
{
    byte[] Protect(string plaintext);
    string Unprotect(byte[] ciphertext);
}
