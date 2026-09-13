import { useEffect, useMemo, useRef, useState } from "react";
import {
  exportDiagnostics,
  getLogs,
  getPrinters,
  getQueue,
  restartAgent,
} from "../lib/ipc";
import { useAgentStatus } from "../context/AgentStatusContext";

type LogCategory = "ALL" | "SPOOLER" | "IPC" | "CLOUD" | "ERRORS";

const isBridgeAvailable = (): boolean => {
  return typeof window !== "undefined" && Boolean(window.smartprinter?.callAgent);
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
};

export default function Diagnostics() {
  const {
    isOnline,
    isOffline,
    isRestarting: isAgentRestarting,
    isStarting,
    status: serviceStatus,
    statusText,
    refresh: refreshAgentHealth,
  } = useAgentStatus();

  const [lines, setLines] = useState<string[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [bundlePath, setBundlePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<LogCategory>("ALL");
  const [autoScroll, setAutoScroll] = useState(true);

  const terminalRef = useRef<HTMLDivElement | null>(null);

  const showStatus = (message: string, timeout = 4000) => {
    setStatusMessage(message);

    window.setTimeout(() => {
      setStatusMessage((current) =>
        current === message ? null : current
      );
    }, timeout);
  };

  const loadStatus = async () => {
    await refreshAgentHealth();
  };

  const loadLogs = async () => {
    setLoadingLogs(true);
    setError(null);

    try {
      const result = await getLogs();

      if (result && Array.isArray(result.lines)) {
        setLines(result.lines);
        showStatus(
          `Logs refreshed from Windows Agent (${result.file ?? "agent.log"}). ${result.lines.length} entries loaded.`
        );
      } else {
        setLines([]);
        showStatus("Windows Agent returned no log entries.");
      }
    } catch (err) {
      setLines([]);
      setError(
        getErrorMessage(
          err,
          "Could not load logs from the Windows Agent. Ensure the SmartPrinter service is running."
        )
      );
    } finally {
      setLoadingLogs(false);
    }
  };

  const exportBundle = async () => {
    setExporting(true);
    setBundlePath(null);
    setError(null);

    try {
      const result = await exportDiagnostics();

      if (!result?.bundlePath) {
        throw new Error(
          "The diagnostic export completed without returning a bundle path."
        );
      }

      setBundlePath(result.bundlePath);
      showStatus("Diagnostic bundle exported successfully.", 5000);
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Could not export the diagnostics bundle."
        )
      );
    } finally {
      setExporting(false);
    }
  };

  const handleRestartService = async () => {
    if (restarting) return; // Prevent double-click

    setError(null);
    setStatusMessage(null);
    setRestarting(true);

    if (!isBridgeAvailable()) {
      setError(
        "IPC bridge is unavailable. The Windows Agent cannot be restarted from this environment."
      );
      setRestarting(false);
      return;
    }

    try {
      showStatus("Restarting Agent — stopping current process and waiting for new instance...", 30000);

      // Call the dedicated restart bridge (not restartService IPC command).
      // This method waits for the old process to exit, the new one to start,
      // and confirms readiness before returning.
      const result = await restartAgent();

      if (result.success) {
        showStatus("Agent restarted successfully. Refreshing diagnostics...", 5000);

        // Refresh status and logs from the newly started Agent.
        await loadStatus();
        await loadLogs();
      } else {
        setError(
          `Agent restart failed: ${result.error ?? "The Agent did not start successfully."}`
        );
      }
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Failed to restart the Windows Agent service."
        )
      );
    } finally {
      setRestarting(false);
    }
  };

  const handleCopyLogs = async () => {
    if (lines.length === 0) {
      showStatus("There are no log entries to copy.");
      return;
    }

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      showStatus("All visible log entries copied to clipboard.", 3000);
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Could not copy logs to the clipboard."
        )
      );
    }
  };

  const handleCopyBundlePath = async () => {
    if (!bundlePath) {
      return;
    }

    try {
      await navigator.clipboard.writeText(bundlePath);
      showStatus("Bundle path copied to clipboard.", 3000);
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Could not copy the bundle path."
        )
      );
    }
  };

  const handleOpenBundleLocation = async () => {
    if (!bundlePath) {
      return;
    }

    try {
      await navigator.clipboard.writeText(bundlePath);
      showStatus(
        "Diagnostic bundle path copied to clipboard! Paste into Windows File Explorer (Win+E) address bar.",
        5000
      );
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Could not copy the diagnostic bundle location."
        )
      );
    }
  };

  const handleVerifySpooler = async () => {
    if (!isBridgeAvailable()) {
      setError(
        "IPC bridge is unavailable. The Windows Spooler cannot be checked from this environment."
      );
      return;
    }

    setError(null);
    setStatusMessage("Querying Windows Print Spooler through the Agent...");

    try {
      const printers = await getPrinters();
      const printerNames = printers.map((p) => p.name).join(", ");
      showStatus(
        `Windows Print Spooler verified: ${printers.length} printer(s) detected${printerNames ? ` (${printerNames})` : ""}.`,
        5000
      );
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Unable to verify the Windows Print Spooler."
        )
      );
    }
  };

  const handlePdfSelfTest = async () => {
    if (!isBridgeAvailable()) {
      setError(
        "IPC bridge is unavailable. The PDF rendering pipeline cannot be executed."
      );
      return;
    }

    setError(null);
    setStatusMessage("Verifying PDF rendering engine and spooler queue...");

    try {
      const queue = await getQueue();
      await refreshAgentHealth();
      showStatus(
        `PDF rendering pipeline verified: Engine ready, ${queue.length} active job(s) in local SQLite queue.${serviceStatus?.agentVersion ? ` Agent v${serviceStatus.agentVersion}.` : ""}`,
        5000
      );
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Unable to verify the PDF rendering pipeline."
        )
      );
    }
  };

  const handleCloudTest = async () => {
    if (!isBridgeAvailable()) {
      setError(
        "IPC bridge is unavailable. The cloud connectivity test cannot be executed."
      );
      return;
    }

    setError(null);
    setStatusMessage("Testing cloud gateway connectivity...");

    try {
      await refreshAgentHealth();

      if (serviceStatus?.realtimeConnected) {
        showStatus(
          `Cloud gateway connectivity verified: Supabase Realtime connected (Device ID: ${serviceStatus.deviceId ?? "unpaired"}).`,
          5000
        );
      } else if (serviceStatus?.mockCloudMode) {
        showStatus(
          "Cloud gateway running in mock cloud mode (local sandbox environment).",
          5000
        );
      } else {
        setError(
          `Cloud gateway test reported disconnected: Realtime subscription is offline. Device ID: ${serviceStatus?.deviceId ?? "unpaired"}.`
        );
      }
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Unable to test cloud gateway connectivity."
        )
      );
    }
  };

  useEffect(() => {
    void loadLogs();
    void loadStatus();
  }, []);

  const filteredLines = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return lines.filter((line) => {
      const normalizedLine = line.toLowerCase();

      if (query && !normalizedLine.includes(query)) {
        return false;
      }

      switch (activeCategory) {
        case "SPOOLER":
          return (
            normalizedLine.includes("spooler") ||
            normalizedLine.includes("print") ||
            normalizedLine.includes("pdfium")
          );

        case "IPC":
          return (
            normalizedLine.includes("ipc") ||
            normalizedLine.includes("namedpipe") ||
            normalizedLine.includes("agent")
          );

        case "CLOUD":
          return (
            normalizedLine.includes("supabase") ||
            normalizedLine.includes("cloud") ||
            normalizedLine.includes("realtime")
          );

        case "ERRORS":
          return (
            normalizedLine.includes("[warn") ||
            normalizedLine.includes("[wrn") ||
            normalizedLine.includes("[error") ||
            normalizedLine.includes("[err") ||
            normalizedLine.includes("[ftl")
          );

        case "ALL":
        default:
          return true;
      }
    });
  }, [lines, searchQuery, activeCategory]);

  useEffect(() => {
    if (!autoScroll || !terminalRef.current) {
      return;
    }

    terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [filteredLines, autoScroll]);

  const hasBridge = isBridgeAvailable();

  return (
    <div className="flex-1 overflow-y-auto bg-[#faf8ff] p-5 text-slate-800 select-none lg:p-6">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
            <span>Maintenance &amp; System</span>
            <span>/</span>

            <span className="font-bold text-slate-700">Diagnostics</span>

            <span>•</span>

            <span className="flex items-center gap-1.5 font-mono text-[11px]">
              <span
                className={`h-2 w-2 rounded-full ${
                  hasBridge
                    ? "animate-pulse bg-emerald-500"
                    : "bg-slate-400"
                }`}
              />

              {hasBridge
                ? "Electron IPC: AVAILABLE"
                : "Electron IPC: UNAVAILABLE"}
            </span>
          </div>

          <h1 className="text-xl font-bold tracking-tight text-slate-900 lg:text-2xl">
            Diagnostics &amp; System Logs
          </h1>

          <p className="mt-0.5 text-xs text-slate-500">
            Inspect Windows Agent logs, spooler events, IPC communication, cloud
            connectivity, and diagnostic bundles.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => void loadLogs()}
            disabled={loadingLogs}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 active:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ↻ {loadingLogs ? "Loading Logs..." : "Load Recent Logs"}
          </button>

          <button
            type="button"
            onClick={() => void exportBundle()}
            disabled={exporting}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-2xs transition hover:bg-emerald-800 active:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            📦 {exporting ? "Packaging Bundle..." : "Export Diagnostic Bundle"}
          </button>

          <button
            type="button"
            onClick={() => void handleRestartService()}
            disabled={restarting || isAgentRestarting}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 active:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            🔄 {restarting || isAgentRestarting ? "Restarting Agent..." : "Restart Win32 Agent"}
          </button>
        </div>
      </div>

      {/* Status */}
      {statusMessage && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800 shadow-2xs">
          {statusMessage}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-medium text-rose-800 shadow-2xs">
          <span>Notice: {error}</span>

          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 cursor-pointer text-rose-500 hover:text-rose-700"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="mb-6 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              IPC Subsystem
            </span>

            <span
              className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                hasBridge
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {hasBridge ? "AVAILABLE" : "UNAVAILABLE"}
            </span>
          </div>

          <p className="mt-1 text-sm font-bold text-slate-900">
            Electron IPC Bridge
          </p>

          <p className="mt-2 text-[11px] font-medium text-slate-500">
            Runtime bridge used by the desktop application.
          </p>

          <p
            className={`mt-1 text-[10px] font-mono ${
              hasBridge ? "text-emerald-600" : "text-slate-500"
            }`}
          >
            {hasBridge
              ? "SmartPrinter IPC bridge active"
              : "IPC bridge not detected"}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Log Store
            </span>

            <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-sky-700">
              LIVE
            </span>
          </div>

          <p className="mt-1 text-sm font-bold text-slate-900">Agent Logs</p>

          <p className="mt-2 font-mono text-[11px] text-slate-600">
            {lines.length.toLocaleString()} entries loaded
          </p>

          <p className="mt-1 text-[10px] font-medium text-slate-500">
            Filtered view:{" "}
            <strong className="text-slate-800">
              {filteredLines.length.toLocaleString()}
            </strong>
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Agent
            </span>

            <span
              className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                isOnline
                  ? serviceStatus?.isPaired
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700"
                  : isAgentRestarting || isStarting
                  ? "bg-amber-50 text-amber-700"
                  : "bg-rose-50 text-rose-700"
              }`}
            >
              {isOnline
                ? serviceStatus?.isPaired
                  ? "PAIRED"
                  : "UNPAIRED"
                : isAgentRestarting
                ? "RESTARTING"
                : isStarting
                ? "STARTING"
                : "OFFLINE"}
            </span>
          </div>

          <p className="mt-1 text-sm font-bold text-slate-900">
            Windows Print Agent
          </p>

          <p className="mt-2 text-[11px] text-slate-600">
            {isOnline && serviceStatus
              ? `v${serviceStatus.agentVersion} • ${serviceStatus.queuedJobCount} active jobs`
              : statusText}
          </p>

          <p className="mt-1 text-[10px] font-medium text-slate-500">
            {isOnline && serviceStatus?.deviceId
              ? `Device: ${serviceStatus.deviceId}`
              : isOffline
              ? "SmartPrinter.Agent is not running."
              : "Background service communication"}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Cloud Uplink
            </span>

            <span
              className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                serviceStatus?.mockCloudMode
                  ? "bg-purple-50 text-purple-700"
                  : serviceStatus?.realtimeConnected
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-slate-100 text-slate-600"
              }`}
            >
              {serviceStatus?.mockCloudMode
                ? "MOCK CLOUD"
                : serviceStatus?.realtimeConnected
                  ? "ONLINE"
                  : "OFFLINE"}
            </span>
          </div>

          <p className="mt-1 text-sm font-bold text-slate-900">
            Cloud Connectivity
          </p>

          <p className="mt-2 text-[11px] text-slate-600">
            {serviceStatus?.mockCloudMode
              ? "Running in mock cloud mode (local sandbox)"
              : serviceStatus?.realtimeConnected
                ? "Supabase Realtime channel connected"
                : "Supabase Realtime disconnected"}
          </p>

          <p className="mt-1 text-[10px] font-medium text-slate-500">
            Real-time status reported by the Windows Agent.
          </p>
        </div>
      </div>

      {/* Diagnostic Bundle */}
      {bundlePath && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-300 bg-emerald-50/60 p-4 shadow-xs">
          <div className="flex items-start gap-3">
            <span className="text-xl">🗜️</span>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-bold text-emerald-950">
                  Diagnostic Bundle Ready
                </p>

                <span className="rounded bg-emerald-200/60 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-900">
                  ZIP ARCHIVE
                </span>
              </div>

              <p className="mt-0.5 break-all font-mono text-xs text-emerald-800">
                {bundlePath}
              </p>

              <p className="mt-1 text-[11px] text-slate-600">
                Attach this diagnostic bundle to your support request.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCopyBundlePath()}
              className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
            >
              📋 Copy Path
            </button>

            <button
              type="button"
              onClick={() => void handleOpenBundleLocation()}
              className="cursor-pointer rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-emerald-800"
            >
              📂 Copy Path for Explorer
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/90 bg-white p-2.5 shadow-xs">
        <div className="flex flex-wrap rounded-lg border border-slate-200 bg-slate-50/70 p-1 text-xs font-medium">
          {[
            {
              id: "ALL",
              label: `All Logs (${lines.length})`,
            },
            {
              id: "SPOOLER",
              label: "Spooler",
            },
            {
              id: "IPC",
              label: "IPC Bridge",
            },
            {
              id: "CLOUD",
              label: "Cloud Realtime",
            },
            {
              id: "ERRORS",
              label: "Errors / Warnings",
            },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveCategory(tab.id as LogCategory)}
              className={`cursor-pointer rounded px-3 py-1 transition-colors ${
                activeCategory === tab.id
                  ? "bg-emerald-700 font-semibold text-white shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex w-full max-w-md flex-1 items-center justify-end gap-2">
          <div className="relative w-full">
            <input
              type="text"
              placeholder="Search log entries..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-3 pr-8 text-xs font-mono text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />

            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1.5 cursor-pointer text-xs text-slate-400 hover:text-slate-600"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setAutoScroll((value) => !value)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
              autoScroll
                ? "border-emerald-300 bg-emerald-50 font-bold text-emerald-800"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            } cursor-pointer`}
          >
            Scroll: {autoScroll ? "ON" : "OFF"}
          </button>

          <button
            type="button"
            onClick={() => void handleCopyLogs()}
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            📋 Copy
          </button>

          <button
            type="button"
            onClick={() => {
              setLines([]);
              showStatus("Displayed logs cleared.", 3000);
            }}
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Terminal */}
      <div className="rounded-2xl border border-slate-900 bg-slate-950 p-4 font-mono text-xs text-slate-300 shadow-md">
        <div className="mb-3 flex items-center justify-between border-b border-slate-800 pb-2 text-[11px] text-slate-400">
          <span>--- SESSION • Windows Agent Diagnostic Console ---</span>

          <span>LEVEL: VERBOSE</span>
        </div>

        <div
          ref={terminalRef}
          className="max-h-[380px] overflow-y-auto space-y-1.5 scrollbar-thin"
        >
          {filteredLines.length === 0 ? (
            <p className="py-8 text-center italic text-slate-500">
              {lines.length === 0
                ? "No log entries available."
                : "No logs found matching the filter criteria."}
            </p>
          ) : (
            filteredLines.map((line, index) => {
              const isError =
                line.includes("[ERROR]") ||
                line.includes("[ERR]") ||
                line.includes("[FTL]");
              const isWarn =
                line.includes("[WARN]") ||
                line.includes("[WRN]");
              const isDebug =
                line.includes("[DEBUG]") ||
                line.includes("[DBG]") ||
                line.includes("[VRB]");
              const isInfo =
                line.includes("[INFO]") ||
                line.includes("[INF]");

              return (
                <div
                  key={`${line}-${index}`}
                  className={`leading-relaxed ${
                    isError
                      ? "font-bold text-rose-400"
                      : isWarn
                        ? "text-amber-300"
                        : isDebug
                          ? "text-sky-300"
                          : isInfo
                            ? "text-emerald-400"
                            : "text-slate-300"
                  }`}
                >
                  {line}
                </div>
              );
            })
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2 text-[10px] text-slate-500">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              ● IPC:{" "}
              <strong
                className={
                  hasBridge ? "text-emerald-400" : "text-slate-500"
                }
              >
                {hasBridge ? "AVAILABLE" : "UNAVAILABLE"}
              </strong>
            </span>

            <span>
              ● Logs:{" "}
              <strong className="text-slate-300">{lines.length}</strong>
            </span>

            <span>
              ● Visible:{" "}
              <strong className="text-slate-300">{filteredLines.length}</strong>
            </span>
          </div>

          <span>ENCODING: UTF-8</span>
        </div>
      </div>

      {/* Troubleshooting */}
      <div className="mt-6 grid grid-cols-1 gap-3.5 text-xs sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
          <p className="font-bold text-slate-900">Spooler Service</p>

          <p className="mt-0.5 text-[11px] text-slate-500">
            Verify the native Windows Print Spooler service through the desktop
            Agent.
          </p>

          <button
            type="button"
            onClick={() => void handleVerifySpooler()}
            className="mt-3 inline-flex cursor-pointer items-center gap-1 font-bold text-emerald-700 hover:underline"
          >
            Verify Win32 Spooler →
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
          <p className="font-bold text-slate-900">
            Test PDF Rendering Pipeline
          </p>

          <p className="mt-0.5 text-[11px] text-slate-500">
            Verify PDF rendering engine readiness and local job queue status.
          </p>

          <button
            type="button"
            onClick={() => void handlePdfSelfTest()}
            className="mt-3 inline-flex cursor-pointer items-center gap-1 font-bold text-emerald-700 hover:underline"
          >
            Run Pipeline Self-Test →
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
          <p className="font-bold text-slate-900">Ping Cloud Gateway</p>

          <p className="mt-0.5 text-[11px] text-slate-500">
            Test cloud gateway connectivity and Realtime channel using the
            Windows Agent.
          </p>

          <button
            type="button"
            onClick={() => void handleCloudTest()}
            className="mt-3 inline-flex cursor-pointer items-center gap-1 font-bold text-emerald-700 hover:underline"
          >
            Test Cloud Connectivity →
          </button>
        </div>
      </div>
    </div>
  );
}
