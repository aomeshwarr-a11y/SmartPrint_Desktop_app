import type { IpcCommand, IpcResponse } from "@shared/index";

export {};

declare global {
  interface Window {
    smartprinter?: {
      callAgent: <T = unknown>(
        command: IpcCommand,
        payload?: unknown
      ) => Promise<IpcResponse<T>>;
      openExternal?: (url: string) => Promise<void>;
      onAgentEvent?: (
        callback: (event: string, payload: unknown) => void
      ) => () => void;
      getAppVersion?: () => Promise<string>;
      minimize?: () => Promise<void>;
      maximize?: () => Promise<void>;
      close?: () => Promise<void>;
    };
  }
}