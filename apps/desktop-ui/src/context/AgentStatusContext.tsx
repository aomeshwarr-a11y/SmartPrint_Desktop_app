import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ServiceStatusDto } from "@shared/index";
import { getServiceStatus } from "../lib/ipc";

interface AgentStatusContextValue {
  status: ServiceStatusDto | null;
  error: string | null;
  refresh: () => Promise<void>;
}

const AgentStatusContext = createContext<AgentStatusContextValue | undefined>(undefined);

// A short poll interval here is fine and does NOT repeat the "excessive Supabase
// requests" mistake from the Raspberry Pi era - this call never leaves the local
// machine, it just asks the already-running agent process for its current in-memory
// status over the named pipe.
const POLL_INTERVAL_MS = 4000;

export function AgentStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ServiceStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const result = await getServiceStatus();
      setStatus(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reach SmartPrinter.Agent.");
    }
  }

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return <AgentStatusContext.Provider value={{ status, error, refresh }}>{children}</AgentStatusContext.Provider>;
}

export function useAgentStatus(): AgentStatusContextValue {
  const context = useContext(AgentStatusContext);
  if (!context) throw new Error("useAgentStatus must be used within an AgentStatusProvider.");
  return context;
}
