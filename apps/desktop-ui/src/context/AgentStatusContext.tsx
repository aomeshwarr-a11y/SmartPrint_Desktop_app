import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AgentConnectionState,
  AgentHealthStatus,
  ServiceStatusDto,
} from "@shared/index";
import { getServiceStatus } from "../lib/ipc";

export interface AgentStatusContextValue {
  connectionState: AgentConnectionState;
  status: ServiceStatusDto | null;
  error: string | null;
  isOnline: boolean;
  isOffline: boolean;
  isRestarting: boolean;
  isStarting: boolean;
  statusText: string;
  refresh: () => Promise<void>;
}

const AgentStatusContext = createContext<AgentStatusContextValue | undefined>(
  undefined
);

export function AgentStatusProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<AgentHealthStatus>({
    state: "offline",
    serviceStatus: null,
    error: "SmartPrinter.Agent is not running",
  });

  const isMountedRef = useRef(true);

  const updateHealth = (newHealth: AgentHealthStatus) => {
    if (!isMountedRef.current) return;
    setHealth(newHealth);
  };

  const refresh = async () => {
    if (window.smartprinter?.checkAgentHealth) {
      try {
        const res = await window.smartprinter.checkAgentHealth();
        updateHealth(res);
      } catch (err) {
        updateHealth({
          state: "offline",
          serviceStatus: null,
          error: err instanceof Error ? err.message : "Health check failed",
        });
      }
    } else {
      // Fallback for non-Electron / browser environments
      try {
        const status = await getServiceStatus();
        updateHealth({
          state: "online",
          serviceStatus: status,
          error: undefined,
        });
      } catch (err) {
        updateHealth({
          state: "offline",
          serviceStatus: null,
          error: err instanceof Error ? err.message : "Unable to reach SmartPrinter.Agent",
        });
      }
    }
  };

  useEffect(() => {
    isMountedRef.current = true;

    // 1. Query initial state immediately from Electron main process
    if (window.smartprinter?.getAgentStatus) {
      window.smartprinter
        .getAgentStatus()
        .then((initialStatus) => {
          updateHealth(initialStatus);
        })
        .catch(() => {
          updateHealth({
            state: "offline",
            serviceStatus: null,
            error: "Unable to determine agent status",
          });
        });
    } else {
      void refresh();
    }

    // 2. Subscribe to status push events from Electron Main
    let unsubscribe: (() => void) | undefined;
    if (window.smartprinter?.onAgentStatusChange) {
      unsubscribe = window.smartprinter.onAgentStatusChange((newStatus) => {
        updateHealth(newStatus);
      });
    }

    return () => {
      isMountedRef.current = false;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  const isOnline = health.state === "online";
  const isRestarting = health.state === "restarting";
  const isStarting = health.state === "starting";
  const isOffline = health.state === "offline" || health.state === "error";

  let statusText: string;
  switch (health.state) {
    case "online":
      statusText = "Connected / Running";
      break;
    case "restarting":
      statusText = "Restarting...";
      break;
    case "starting":
      statusText = "Connecting...";
      break;
    case "error":
      statusText = "Agent Offline";
      break;
    case "offline":
    default:
      statusText = "Agent Offline";
      break;
  }

  const value: AgentStatusContextValue = {
    connectionState: health.state,
    status: isOnline ? health.serviceStatus : null,
    error: health.error || null,
    isOnline,
    isOffline,
    isRestarting,
    isStarting,
    statusText,
    refresh,
  };

  return (
    <AgentStatusContext.Provider value={value}>
      {children}
    </AgentStatusContext.Provider>
  );
}

export function useAgentStatus(): AgentStatusContextValue {
  const context = useContext(AgentStatusContext);
  if (!context) {
    throw new Error("useAgentStatus must be used within an AgentStatusProvider.");
  }
  return context;
}
