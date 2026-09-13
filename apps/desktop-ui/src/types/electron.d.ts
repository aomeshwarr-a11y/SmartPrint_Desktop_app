import type {
  AgentHealthStatus,
  AgentRestartResult,
  IpcCommand,
} from "@shared/index";

export {};

declare global {
  interface Window {
    smartprinter: {
      callAgent: <T = unknown>(
        command: IpcCommand,
        payload?: unknown
      ) => Promise<T>;
      restartAgent: () => Promise<AgentRestartResult>;
      getAgentStatus?: () => Promise<AgentHealthStatus>;
      checkAgentHealth?: () => Promise<AgentHealthStatus>;
      onAgentStatusChange?: (
        callback: (status: AgentHealthStatus) => void
      ) => () => void;
      openExternal?: (url: string) => Promise<void>;
      onUpdateDownloaded: (callback: () => void) => void;
    };
  }
}