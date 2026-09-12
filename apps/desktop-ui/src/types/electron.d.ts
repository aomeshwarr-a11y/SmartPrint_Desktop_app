import type { AgentRestartResult, IpcCommand } from "@shared/index";

export {};

declare global {
  interface Window {
    smartprinter?: {
      callAgent: <T = unknown>(
        command: IpcCommand,
        payload?: unknown
      ) => Promise<T>;
      restartAgent?: () => Promise<AgentRestartResult>;
      openExternal?: (url: string) => Promise<void>;
      onUpdateDownloaded?: (callback: () => void) => void;
    };
  }
}