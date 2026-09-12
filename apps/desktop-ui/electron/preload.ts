import { contextBridge, ipcRenderer } from "electron";
import type { IpcCommand } from "@smartprinter/shared-contracts";

/**
 * The ONLY surface the renderer (React app) can use to reach outside its sandbox. This
 * follows Electron's recommended contextBridge pattern: nothing here gives the page raw
 * ipcRenderer, Node's require, or filesystem access - only narrow async functions.
 */
contextBridge.exposeInMainWorld("smartprinter", {
  callAgent: (command: IpcCommand, payload?: unknown) => ipcRenderer.invoke("agent:call", command, payload),
  restartAgent: () => ipcRenderer.invoke("agent:restart"),
  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
  onUpdateDownloaded: (callback: () => void) => {
    ipcRenderer.on("update:downloaded", () => callback());
  },
});

export {};
