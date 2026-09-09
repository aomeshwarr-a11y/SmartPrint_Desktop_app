import type { IpcCommand } from "@shared/index";

export {};

declare global {
  interface Window {
    smartprinter: {
      callAgent: <TResponse = unknown>(command: IpcCommand, payload?: unknown) => Promise<TResponse>;
      openExternal: (url: string) => Promise<void>;
      onUpdateDownloaded: (callback: () => void) => void;
    };
  }
}
