using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SmartPrinter.Agent.Configuration;

namespace SmartPrinter.Agent.Ipc;

/// <summary>
/// Hosts a Windows named pipe (\\.\pipe\{PipeName}) that the Electron UI connects to as a
/// client. This is used instead of a localhost HTTP server specifically because:
///   - Named pipes are not visible on the network, and can be ACL'd to specific Windows
///     principals (see BuildPipeSecurity) - an unauthenticated localhost HTTP port is
///     reachable by any other process/user on the machine that can hit 127.0.0.1.
///   - No port to accidentally expose via a firewall misconfiguration.
///
/// Protocol: newline-delimited JSON. Each line from the client is an <see cref="IpcRequest"/>;
/// each line written back is the corresponding <see cref="IpcResponse"/>. One request per
/// line keeps this trivial to implement correctly on both the .NET and Node sides without
/// a full RPC framework.
/// </summary>
public sealed class NamedPipeServer
{
    private readonly IpcRouter _router;
    private readonly AgentOptions _options;
    private readonly ILogger<NamedPipeServer> _logger;

    public NamedPipeServer(IpcRouter router, IOptions<AgentOptions> options, ILogger<NamedPipeServer> logger)
    {
        _router = router;
        _options = options.Value;
        _logger = logger;
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            NamedPipeServerStream? pipe = null;
            try
            {
                pipe = CreatePipe();
                await pipe.WaitForConnectionAsync(cancellationToken);
                _logger.LogInformation("Electron UI connected to IPC pipe");
                _ = HandleClientAsync(pipe, cancellationToken);
                // HandleClientAsync owns disposal of `pipe` - don't dispose it here.
                pipe = null;
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Named pipe server loop error - restarting listener");
                await Task.Delay(TimeSpan.FromSeconds(2), cancellationToken);
            }
            finally
            {
                pipe?.Dispose();
            }
        }
    }

    private NamedPipeServerStream CreatePipe()
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("Named pipes with ACLs require Windows.");
        }

        var security = BuildPipeSecurity();
        return NamedPipeServerStreamAcl.Create(
            _options.PipeName,
            PipeDirection.InOut,
            NamedPipeServerStream.MaxAllowedServerInstances,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous,
            inBufferSize: 65536,
            outBufferSize: 65536,
            pipeSecurity: security);
    }

    private static PipeSecurity BuildPipeSecurity()
    {
        var security = new PipeSecurity();

        // Interactive logged-on users (the shop owner running the Electron UI) may
        // read/write; the service itself (running as LocalSystem/NetworkService) needs
        // full control to host the pipe. Everyone else - including remote/network
        // callers, which named pipes of this form never accept anyway - is excluded.
        security.AddAccessRule(new PipeAccessRule(
            new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null),
            PipeAccessRights.ReadWrite,
            AccessControlType.Allow));

        security.AddAccessRule(new PipeAccessRule(
            new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            PipeAccessRights.FullControl,
            AccessControlType.Allow));

        security.AddAccessRule(new PipeAccessRule(
            new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null),
            PipeAccessRights.FullControl,
            AccessControlType.Allow));

        return security;
    }

    private async Task HandleClientAsync(NamedPipeServerStream pipe, CancellationToken cancellationToken)
    {
        using (pipe)
        {
            try
            {
                using var reader = new StreamReader(pipe, Encoding.UTF8, leaveOpen: true);
                await using var writer = new StreamWriter(pipe, Encoding.UTF8, leaveOpen: true) { AutoFlush = true };

                while (pipe.IsConnected && !cancellationToken.IsCancellationRequested)
                {
                    var line = await reader.ReadLineAsync(cancellationToken);
                    if (line == null) break;

                    IpcResponse response;
                    try
                    {
                        var request = JsonSerializer.Deserialize<IpcRequest>(line)
                                      ?? throw new InvalidOperationException("Malformed IPC request.");
                        response = await _router.DispatchAsync(request, cancellationToken);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to process IPC request line");
                        response = IpcResponse.Fail("unknown", "Malformed request or internal error.");
                    }

                    var json = JsonSerializer.Serialize(response);
                    await writer.WriteLineAsync(json);
                }
            }
            catch (IOException)
            {
                // Client disconnected - normal when the UI window is closed.
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "IPC client handler terminated unexpectedly");
            }
        }
    }
}
