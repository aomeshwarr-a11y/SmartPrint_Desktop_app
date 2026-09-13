import * as net from "node:net";
import { randomUUID } from "node:crypto";

/**
 * Client-side half of the named pipe IPC protocol implemented in
 * services/desktop-agent/SmartPrinter.Agent/Ipc/NamedPipeServer.cs. This runs in
 * Electron's MAIN process (never the renderer) - the renderer only ever talks to this
 * class through the secure preload bridge (see preload.ts), which is the standard
 * "contextIsolation + no direct Node/net access from the page" Electron security model.
 *
 * Protocol: one JSON object per line, both directions. Requests carry a client-generated
 * `id`; responses echo it back so concurrent calls can be matched even though the pipe is
 * a single duplex byte stream per connection.
 */

const PIPE_NAME = process.platform === "win32" ? "\\\\.\\pipe\\SmartPrinterAgentPipe" : "/tmp/smartprinter-agent-dev.sock";

interface PendingCall {
  resolve: (value: any) => void;
  reject: (reason: unknown) => void;
  timeout: NodeJS.Timeout;
}

export class AgentPipeClient {
  private socket: net.Socket | null = null;
  private buffer = "";
  private pending = new Map<string, PendingCall>();
  private connecting: Promise<void> | null = null;
  private reconnectDelayMs = 1000;
  private connectionListeners: Array<(connected: boolean, err?: Error) => void> = [];

  public isConnected(): boolean {
    return Boolean(this.socket && !this.socket.destroyed);
  }

  public onConnectionChange(listener: (connected: boolean, err?: Error) => void): () => void {
    this.connectionListeners.push(listener);
    return () => {
      this.connectionListeners = this.connectionListeners.filter((l) => l !== listener);
    };
  }

  private notifyConnectionChange(connected: boolean, err?: Error): void {
    for (const listener of [...this.connectionListeners]) {
      try {
        listener(connected, err);
      } catch {
        // ignore callback error
      }
    }
  }

  async call<TResponse = unknown>(command: string, payload?: unknown, timeoutMs = 15000): Promise<TResponse> {
    await this.ensureConnected();

    return new Promise<TResponse>((resolve, reject) => {
      const id = randomUUID();
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`IPC call '${command}' timed out after ${timeoutMs}ms - is SmartPrinter.Agent running?`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });

      const request = JSON.stringify({ id, command, payload }) + "\n";
      this.socket!.write(request, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  /**
   * Sends the RestartService command, then waits for the Agent process to exit and
   * come back up. Returns only after the new Agent is confirmed responsive on the pipe.
   *
   * Flow:
   * 1. Send RestartService → Agent responds { restarting: true } then exits after 500ms.
   * 2. The pipe connection closes (onClose fires, rejecting any remaining pending calls).
   * 3. Poll for reconnection with exponential backoff, up to ~30 seconds total.
   * 4. Once reconnected, call GetServiceStatus to confirm the Agent is fully ready.
   * 5. Return the live ServiceStatus to the caller.
   */
  async restartAgent(): Promise<{ success: boolean; status?: unknown; error?: string }> {
    // Step 1: Send the restart signal. The Agent will exit(0) after ~500ms.
    // The response may arrive before exit, or the pipe may close before we get it.
    try {
      await this.call("RestartService", undefined, 3000);
    } catch {
      // Expected: pipe closes when the Agent exits. The RestartService response may
      // or may not arrive before the process dies - either way, we proceed.
    }

    // Step 2: Drop the existing socket. The Agent is exiting/exited.
    this.disconnect();

    // Step 3: Wait a moment for the old process to fully exit before polling.
    await this.sleep(1500);

    // Step 4: Poll for the new Agent to start and accept pipe connections.
    const maxAttempts = 12;
    let lastError = "";
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.ensureConnected();

        // Step 5: Pipe connected - call GetServiceStatus to verify Agent is fully ready.
        const status = await this.call("GetServiceStatus", undefined, 5000);
        return { success: true, status };
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
        this.disconnect();

        if (attempt < maxAttempts) {
          // Backoff: 1s, 1.5s, 2s, 2.5s, 3s ... up to 3s
          const delay = Math.min(1000 + (attempt - 1) * 500, 3000);
          await this.sleep(delay);
        }
      }
    }

    return {
      success: false,
      error: `Agent did not come back online after restart. Last error: ${lastError}`,
    };
  }

  private ensureConnected(): Promise<void> {
    if (this.socket && !this.socket.destroyed) {
      return Promise.resolve();
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(PIPE_NAME);
      const onError = (err: Error) => {
        this.connecting = null;
        reject(new Error(`Could not connect to SmartPrinter.Agent named pipe (${PIPE_NAME}): ${err.message}`));
      };

      socket.once("error", onError);
      socket.once("connect", () => {
        socket.removeListener("error", onError);
        socket.on("data", (chunk) => this.onData(chunk));
        socket.on("close", () => this.onClose());
        socket.on("error", (err) => this.onClose(err));
        this.socket = socket;
        this.connecting = null;
        this.notifyConnectionChange(true);
        resolve();
      });
    });

    return this.connecting;
  }

  /**
   * Forcibly drops the current socket and clears pending state. Used during restart
   * to ensure a clean reconnection to the new Agent process.
   */
  public disconnect(): void {
    const hadSocket = Boolean(this.socket);
    if (this.socket) {
      try { this.socket.destroy(); } catch { /* ignore */ }
      this.socket = null;
    }
    this.connecting = null;
    this.buffer = "";
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout);
      // Don't reject - the caller (restartAgent) already handles this.
    }
    this.pending.clear();
    if (hadSocket) {
      this.notifyConnectionChange(false);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private onData(chunk: Buffer) {
    this.buffer += chunk.toString("utf8");
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line.trim()) continue;

      try {
        const response = JSON.parse(line) as { id: string; success: boolean; data?: unknown; error?: string };
        const pending = this.pending.get(response.id);
        if (!pending) continue;
        this.pending.delete(response.id);
        clearTimeout(pending.timeout);
        if (response.success) {
          pending.resolve(response.data);
        } else {
          pending.reject(new Error(response.error ?? "Unknown agent error."));
        }
      } catch {
        // Ignore malformed lines rather than crashing the whole IPC channel.
      }
    }
  }

  private onClose(err?: Error) {
    const hadSocket = Boolean(this.socket);
    this.socket = null;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(err ?? new Error("Connection to SmartPrinter.Agent was closed."));
    }
    this.pending.clear();
    if (hadSocket) {
      this.notifyConnectionChange(false, err);
    }
  }
}

export const agentPipeClient = new AgentPipeClient();
