import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AgentHealthStatus, IpcCommand } from "@smartprinter/shared-contracts";

/**
 * The ONLY surface the renderer (React app) can use to reach outside its sandbox. This
 * follows Electron's recommended contextBridge pattern: nothing here gives the page raw
 * ipcRenderer, Node's require, or filesystem access - only narrow async functions.
 */
contextBridge.exposeInMainWorld("smartprinter", {
  callAgent: (command: IpcCommand, payload?: unknown) => ipcRenderer.invoke("agent:call", command, payload),
  restartAgent: () => ipcRenderer.invoke("agent:restart"),
  getAgentStatus: () => ipcRenderer.invoke("agent:get-health"),
  checkAgentHealth: () => ipcRenderer.invoke("agent:check-health"),
  onAgentStatusChange: (callback: (status: AgentHealthStatus) => void) => {
    const handler = (_event: IpcRendererEvent, status: AgentHealthStatus) => callback(status);
    ipcRenderer.on("agent:status-changed", handler);
    return () => {
      ipcRenderer.removeListener("agent:status-changed", handler);
    };
  },
  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
  onUpdateDownloaded: (callback: () => void) => {
    ipcRenderer.on("update:downloaded", () => callback());
  },
});

export {};
