namespace SmartPrinter.Agent.Cloud;

/// <summary>
/// Small in-memory holder for state that both the background <see cref="Worker"/> and the
/// IPC layer need to read/write, so we don't have to thread ad-hoc fields through DI in
/// awkward ways. Nothing here is persisted directly - the durable copy of pairing state
/// lives in <see cref="Security.CredentialStore"/>, and this class is just a cache of it
/// for fast synchronous reads from IpcRouter.
/// </summary>
public sealed class AgentRuntimeState
{
    public Guid? DeviceId { get; set; }
    public Guid? ShopId { get; set; }
    public bool RealtimeConnected { get; set; }
    public DateTime StartedAtUtc { get; } = DateTime.UtcNow;
}
