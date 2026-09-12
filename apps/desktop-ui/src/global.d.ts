import type { AgentRestartResult, IpcCommand } from "@shared/index";

export {};

declare global {
  interface Window {
    smartprinter: {
      callAgent: <TResponse = unknown>(command: IpcCommand, payload?: unknown) => Promise<TResponse>;
      restartAgent: () => Promise<AgentRestartResult>;
      openExternal: (url: string) => Promise<void>;
      onUpdateDownloaded: (callback: () => void) => void;
    };
  }
}
