import { app } from "electron";
import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { agentPipeClient } from "./pipeClient";
import type { AgentRestartResult } from "@smartprinter/shared-contracts";

const execFile = promisify(child_process.execFile);

export class AgentProcessManager {
  private isRestarting = false;

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
        // Format: "SmartPrinter.Agent.exe","10468","Console","4","141,144 K"
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
      // Development build output
      path.resolve(app.getAppPath(), "../../services/desktop-agent/SmartPrinter.Agent/bin/Debug/net8.0-windows/SmartPrinter.Agent.exe"),
      path.resolve(app.getAppPath(), "../services/desktop-agent/SmartPrinter.Agent/bin/Debug/net8.0-windows/SmartPrinter.Agent.exe"),
      // Production install locations
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
   * 1. Rejects concurrent restart calls (mutex).
   * 2. Captures old PIDs.
   * 3. Sends graceful restart signal over Named Pipe.
   * 4. Waits for old process to exit (force-kills if hung after timeout).
   * 5. Confirms old PID is dead.
   * 6. Starts fresh instance via SCM (if Windows Service) or launches binary.
   * 7. Polls Named Pipe until GetServiceStatus returns success.
   * 8. Captures new PID and returns verified status.
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
        child.unref();
      }

      // Step 5: Wait for Agent to become ready on Named Pipe
      const maxAttempts = 20;
      let lastError = "";

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await this.sleep(attempt === 1 ? 1500 : 1000);

        try {
          // Poll GetServiceStatus to verify the IPC server is alive and responding
          await agentPipeClient.call("GetServiceStatus", undefined, 3000);

          // Get the new PID
          const newPids = await this.getRunningAgentPids();
          const newPid = newPids[0];

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

      return {
        success: false,
        status: "stopped",
        error: `Agent started but did not respond to IPC within 20 seconds. ${lastError}`,
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
