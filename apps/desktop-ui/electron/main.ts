import { app, BrowserWindow, ipcMain, shell } from "electron";
import * as path from "node:path";
import { autoUpdater } from "electron-updater";
import { agentPipeClient } from "./pipeClient";

const isDev = process.env.NODE_ENV === "development";

// Allowlist for any external link the renderer asks to open (e.g. "view invoice",
// "SmartPrinter support") - prevents the renderer from using shell.openExternal as an
// arbitrary command/URL launcher. See docs/SECURITY.md "safe external URL handling".
const ALLOWED_EXTERNAL_HOSTS = new Set(["smartprinter.in", "www.smartprinter.in", "supabase.com"]);

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#faf6ee",
    title: "SmartPrinter Desktop",
    webPreferences: {
      // The three settings below are the non-negotiable core of Electron security:
      // the renderer gets NO direct Node.js or Electron API access. Everything it
      // can do is exposed deliberately and narrowly through preload.ts.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  // Never allow the renderer to spawn arbitrary new windows/webviews.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    tryOpenExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function tryOpenExternal(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname)) {
      void shell.openExternal(url);
    }
  } catch {
    // Malformed URL - silently ignore rather than risk shell.openExternal on garbage input.
  }
}

app.whenReady().then(() => {
  createWindow();

  if (!isDev) {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error("Auto-update check failed:", err);
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Closing the UI window must NEVER stop print jobs - the background agent is a
  // separate OS process (a Windows Service) and keeps running regardless. This only
  // quits the Electron shell itself.
  if (process.platform !== "darwin") app.quit();
});

// ---------------- IPC bridge: renderer (via preload) -> main -> named pipe -> agent ----------------
// Every channel here is a 1:1 forward to a specific, known agent command - the renderer
// can never send an arbitrary pipe command string (see preload.ts for the same narrow
// whitelist enforced on the renderer side too, defense in depth).

const AGENT_CALL_CHANNEL = "agent:call";

ipcMain.handle(AGENT_CALL_CHANNEL, async (_event, command: string, payload?: unknown) => {
  return agentPipeClient.call(command, payload);
});

ipcMain.handle("shell:openExternal", (_event, url: string) => {
  tryOpenExternal(url);
});

autoUpdater.on("update-downloaded", () => {
  mainWindow?.webContents.send("update:downloaded");
});
