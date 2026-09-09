import { useAgentStatus } from "../context/AgentStatusContext";
import StatusBadge from "../components/StatusBadge";

export default function Dashboard() {
  const { status, error } = useAgentStatus();

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-xl font-semibold text-brand-900">Dashboard</h1>
      <p className="mb-6 text-sm text-brand-500">A quick look at how your shop's SmartPrinter agent is doing.</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card">
          <p className="text-sm text-brand-500">Pairing</p>
          <p className="mt-1 text-lg font-semibold text-brand-900">{status?.isPaired ? "Paired" : "Not paired"}</p>
        </div>
        <div className="card">
          <p className="text-sm text-brand-500">Cloud connection</p>
          <div className="mt-1">
            <StatusBadge
              status={error ? "Offline" : status?.realtimeConnected ? "Connected" : "Connecting"}
              tone={error ? "error" : status?.realtimeConnected ? "success" : "warning"}
            />
          </div>
        </div>
        <div className="card">
          <p className="text-sm text-brand-500">Jobs in queue</p>
          <p className="mt-1 text-lg font-semibold text-brand-900">{status?.queuedJobCount ?? 0}</p>
        </div>
      </div>

      <div className="card mt-6">
        <p className="text-sm text-brand-500">Agent version</p>
        <p className="mt-1 font-mono text-sm text-brand-900">{status?.agentVersion ?? "unknown"}</p>
        {status?.deviceId && <p className="mt-2 text-xs text-brand-400">Device ID: {status.deviceId}</p>}
        {status?.mockCloudMode && (
          <p className="mt-2 text-xs font-medium text-amber-700">
            Development mock cloud mode is ON - Realtime job delivery is disabled.
          </p>
        )}
      </div>
    </div>
  );
}
