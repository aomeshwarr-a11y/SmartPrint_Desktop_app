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
    private Guid? _agentId;
    private Guid? _branchId;

    public Guid? AgentId
    {
        get => _agentId;
        set => _agentId = value;
    }

    public Guid? BranchId
    {
        get => _branchId;
        set => _branchId = value;
    }

    // Backward-compatible accessors for existing consumers
    public Guid? DeviceId
    {
        get => _agentId;
        set => _agentId = value;
    }

    public Guid? ShopId
    {
        get => _branchId;
        set => _branchId = value;
    }

    public bool RealtimeConnected { get; set; }
    public bool MockCloudMode { get; set; }
    public DateTime StartedAtUtc { get; } = DateTime.UtcNow;
}
