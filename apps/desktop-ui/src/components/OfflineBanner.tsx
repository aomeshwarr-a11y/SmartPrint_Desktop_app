import { useAgentStatus } from "../context/AgentStatusContext";

export default function OfflineBanner() {
  const { status, error } = useAgentStatus();

  if (error) {
    return (
      <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-800">
        Can&apos;t reach the SmartPrinter background service. Jobs will queue once it reconnects. ({error})
      </div>
    );
  }

  if (status && status.isPaired && !status.realtimeConnected) {
    return (
      <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-800">
        Offline — waiting to reconnect to SmartPrinter cloud. Any jobs already queued locally will still print.
        {status.queuedJobCount > 0 ? ` (${status.queuedJobCount} job(s) waiting)` : ""}
      </div>
    );
  }

  return null;
}
