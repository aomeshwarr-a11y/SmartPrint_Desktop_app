import { app } from "electron";
import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { agentPipeClient } from "./pipeClient";
import type {
  AgentConnectionState,
  AgentHealthStatus,
  AgentRestartResult,
  ServiceStatusDto,
} from "@smartprinter/shared-contracts";

const execFile = promisify(child_process.execFile);
const HEALTH_POLL_INTERVAL_MS = 3000;

export class AgentProcessManager {
  private isRestarting = false;
  private childProcess: child_process.ChildProcess | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private statusBroadcaster: ((status: AgentHealthStatus) => void) | null = null;

  private currentHealth: AgentHealthStatus = {
    state: "offline",
    serviceStatus: null,
    error: "SmartPrinter.Agent is not running",
    lastChecked: new Date().toISOString(),
  };

  constructor() {
    // Listen for named pipe connection drops in real-time
    agentPipeClient.onConnectionChange((connected, err) => {
      if (!connected) {
        if (!this.isRestarting) {
          this.transitionState(
            "offline",
            null,
            err?.message || "Named pipe connection closed."
          );
        }
      }
    });
  }

  public setStatusBroadcaster(broadcaster: (status: AgentHealthStatus) => void): void {
    this.statusBroadcaster = broadcaster;
    // Broadcast initial state immediately
    broadcaster(this.currentHealth);
  }

  public getHealthStatus(): AgentHealthStatus {
    return this.currentHealth;
  }

  public startMonitoring(): void {
    if (this.heartbeatTimer) return;

    // Run immediate check
    void this.performHealthCheck();

    this.heartbeatTimer = setInterval(() => {
      void this.performHealthCheck();
    }, HEALTH_POLL_INTERVAL_MS);
  }

  public stopMonitoring(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Probes the Agent over named pipe to retrieve ServiceStatusDto.
   * Updates state machine based on response or error.
   */
  async performHealthCheck(): Promise<AgentHealthStatus> {
    if (this.isRestarting) {
      return this.currentHealth;
    }

    try {
      // 2000ms timeout for health check - fast failure when agent is dead
      const status = await agentPipeClient.call<ServiceStatusDto>("GetServiceStatus", undefined, 2000);
      this.transitionState("online", status, undefined);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.transitionState("offline", null, errMsg);
    }

    return this.currentHealth;
  }

  private transitionState(
    newState: AgentConnectionState,
    serviceStatus: ServiceStatusDto | null,
    error?: string
  ): void {
    const previousState = this.currentHealth.state;
    const changed =
      previousState !== newState ||
      this.currentHealth.serviceStatus?.queuedJobCount !== serviceStatus?.queuedJobCount ||
      this.currentHealth.serviceStatus?.realtimeConnected !== serviceStatus?.realtimeConnected ||
      this.currentHealth.error !== error;

    this.currentHealth = {
      state: newState,
      serviceStatus: newState === "online" ? serviceStatus : null,
      error: newState === "online" ? undefined : error,
      lastChecked: new Date().toISOString(),
    };

    if (changed) {
      this.broadcastStatus();
    }
  }

  private broadcastStatus(): void {
    if (this.statusBroadcaster) {
      try {
        this.statusBroadcaster(this.currentHealth);
      } catch {
        // Ignore broadcast errors
      }
    }
  }

  /**
   * Attaches monitoring listeners to a child process spawned by Electron.
   */
  private monitorChildProcess(child: child_process.ChildProcess): void {
    this.childProcess = child;

    child.on("exit", (code, signal) => {
      this.childProcess = null;
      if (!this.isRestarting) {
        this.transitionState("offline", null, `Agent process exited with code ${code ?? signal ?? "unknown"}`);
      }
    });

    child.on("error", (err) => {
      this.childProcess = null;
      if (!this.isRestarting) {
        this.transitionState("error", null, `Agent process error: ${err.message}`);
      }
    });

    child.on("close", (code, signal) => {
      this.childProcess = null;
      if (!this.isRestarting) {
        this.transitionState("offline", null, `Agent process closed with code ${code ?? signal ?? "unknown"}`);
      }
    });
  }

  /**
   * Retrieves process IDs of any currently running SmartPrinter.Agent instances.
   */
  async getRunningAgentPids(): Promise<number[]> {
    if (process.platform !== "win32") {
      return [];
    }

    try {
      const { stdout } = await execFile("tasklist", [
        "/FI",
        "IMAGENAME eq SmartPrinter.Agent.exe",
        "/FO",
        "CSV",
        "/NH",
      ]);

      const pids: number[] = [];
      const lines = stdout.split("\r\n").filter((l) => l.trim().length > 0);

      for (const line of lines) {
        const parts = line.split(",").map((s) => s.replace(/^"|"$/g, "").trim());
        if (parts[0]?.toLowerCase() === "smartprinter.agent.exe") {
          const pid = parseInt(parts[1], 10);
          if (!isNaN(pid) && pid > 0) {
            pids.push(pid);
          }
        }
      }

      return pids;
    } catch {
      return [];
    }
  }

  /**
   * Checks whether the SmartPrinterAgent Windows Service is registered in SCM.
   */
  async isWindowsServiceInstalled(): Promise<boolean> {
    if (process.platform !== "win32") {
      return false;
    }

    try {
      const { stdout } = await execFile("sc.exe", ["query", "SmartPrinterAgent"]);
      return stdout.includes("SmartPrinterAgent");
    } catch {
      return false;
    }
  }

  /**
   * Forcibly terminates an agent process by PID.
   */
  async terminateProcess(pid: number): Promise<void> {
    try {
      await execFile("taskkill", ["/F", "/PID", String(pid)]);
    } catch {
      // Process may have already exited
    }
  }

  /**
   * Resolves the path to the SmartPrinter.Agent.exe executable across dev and production.
   */
  findAgentExecutable(): string | null {
    const candidates = [
      path.resolve(app.getAppPath(), "../../services/desktop-agent/SmartPrinter.Agent/bin/Debug/net8.0-windows/SmartPrinter.Agent.exe"),
      path.resolve(app.getAppPath(), "../services/desktop-agent/SmartPrinter.Agent/bin/Debug/net8.0-windows/SmartPrinter.Agent.exe"),
      path.join(process.resourcesPath, "agent", "SmartPrinter.Agent.exe"),
      path.join(path.dirname(app.getPath("exe")), "agent", "SmartPrinter.Agent.exe"),
      "C:\\Program Files\\SmartPrinter Desktop\\agent\\SmartPrinter.Agent.exe",
    ];

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch {
        // Path check failed, check next
      }
    }

    return null;
  }

  /**
   * Restarts the desktop Agent process with full verification:
   * 1. Rejects concurrent restart calls.
   * 2. Sets state to "restarting" and broadcasts to frontend.
   * 3. Sends graceful restart signal over Named Pipe.
   * 4. Waits for old process to exit (force-kills if hung after timeout).
   * 5. Sets state to "starting" and broadcasts to frontend.
   * 6. Starts fresh instance via SCM (if Windows Service) or launches binary.
   * 7. Polls Named Pipe until GetServiceStatus returns success.
   * 8. Sets state to "online" and broadcasts to frontend.
   * 9. If restart fails, sets state to "error" ("Agent Offline / Restart Failed").
   */
  async restartAgent(): Promise<AgentRestartResult> {
    if (this.isRestarting) {
      return {
        success: false,
        status: "error",
        error: "Agent restart is already in progress.",
      };
    }

    this.isRestarting = true;
    this.transitionState("restarting", null, "Restarting Agent...");

    try {
      const oldPids = await this.getRunningAgentPids();

      // Step 1: Request graceful shutdown over Named Pipe
      try {
        await agentPipeClient.call("RestartService", undefined, 2000);
      } catch {
        // Expected: pipe disconnects when the agent process terminates
      }

      agentPipeClient.disconnect();

      // Step 2: Wait for old process(es) to exit
      const exitWaitStart = Date.now();
      let remainingPids = oldPids;

      while (remainingPids.length > 0 && Date.now() - exitWaitStart < 3500) {
        await this.sleep(300);
        const currentPids = await this.getRunningAgentPids();
        remainingPids = currentPids.filter((pid) => oldPids.includes(pid));
      }

      // Step 3: If any old process is still hung, force-kill it
      for (const pid of remainingPids) {
        await this.terminateProcess(pid);
      }

      if (remainingPids.length > 0) {
        await this.sleep(500);
      }

      // Old agent has exited; transition to "starting"
      this.transitionState("starting", null, "Starting new Agent instance...");

      // Step 4: Launch fresh agent instance
      const isService = await this.isWindowsServiceInstalled();

      if (isService) {
        try {
          await execFile("sc.exe", ["start", "SmartPrinterAgent"]);
        } catch {
          // Service may already be restarting via SCM recovery policy
        }
      } else {
        const exePath = this.findAgentExecutable();
        if (!exePath) {
          this.transitionState("error", null, "Agent Offline / Restart Failed: executable not found");
          return {
            success: false,
            status: "stopped",
            error: "SmartPrinter.Agent executable was not found on this machine.",
          };
        }

        const child = child_process.spawn(exePath, ["--console"], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
        this.monitorChildProcess(child);
        child.unref();
      }

      // Step 5: Wait for Agent to become ready on Named Pipe
      const maxAttempts = 20;
      let lastError = "";

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await this.sleep(attempt === 1 ? 1500 : 1000);

        try {
          const status = await agentPipeClient.call<ServiceStatusDto>("GetServiceStatus", undefined, 3000);
          const newPids = await this.getRunningAgentPids();
          const newPid = newPids[0];

          this.transitionState("online", status, undefined);

          return {
            success: true,
            pid: newPid,
            status: "running",
          };
        } catch (err: unknown) {
          lastError = err instanceof Error ? err.message : String(err);
          agentPipeClient.disconnect();
        }
      }

      this.transitionState("error", null, "Agent Offline / Restart Failed");
      return {
        success: false,
        status: "stopped",
        error: `Agent Offline / Restart Failed: Agent started but did not respond to IPC within 20 seconds. ${lastError}`,
      };
    } finally {
      this.isRestarting = false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const agentProcessManager = new AgentProcessManager();
