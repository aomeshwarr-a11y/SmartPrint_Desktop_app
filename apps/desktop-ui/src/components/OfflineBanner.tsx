import { useAgentStatus } from "../context/AgentStatusContext";

export default function OfflineBanner() {
  const { isOffline, isRestarting, isStarting, isOnline, status, error } = useAgentStatus();

  if (isOffline) {
    return (
      <div className="border-b border-rose-200 bg-rose-50 px-6 py-2 text-sm text-rose-800">
        SmartPrinter background agent is offline / not running. Print jobs cannot be processed until the agent starts.
        {error ? ` (${error})` : ""}
      </div>
    );
  }

  if (isRestarting || isStarting) {
    return (
      <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-800">
        {isRestarting ? "Restarting SmartPrinter Agent..." : "Connecting to SmartPrinter Agent..."}
      </div>
    );
  }

  if (isOnline && status && status.isPaired && !status.realtimeConnected) {
    return (
      <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-800">
        Offline — waiting to reconnect to SmartPrinter cloud. Any jobs already queued locally will still print.
        {status.queuedJobCount > 0 ? ` (${status.queuedJobCount} job(s) waiting)` : ""}
      </div>
    );
  }

  return null;
}
