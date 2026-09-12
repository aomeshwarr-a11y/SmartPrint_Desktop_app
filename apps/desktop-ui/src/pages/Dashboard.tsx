import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  getPrinters,
  getQueue,
  getServiceStatus,
} from "../lib/ipc";
import type {
  PrinterInfo,
  PrintJobRecord,
  ServiceStatusDto,
} from "@shared/index";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type DashboardPrinterStatus =
  | "idle"
  | "printing"
  | "error"
  | "offline"
  | "attention";

interface DashboardPrinter {
  name: string;
  driverName: string;
  portName: string;
  isDefault: boolean;
  availability: PrinterInfo["availability"];
  fingerprint: string;
}

interface AgentState {
  isConnected: boolean;
  version?: string;
  realtimeConnected: boolean;
  mockCloudMode: boolean;
  queuedJobCount: number;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function getPrinterStatus(
  printer: DashboardPrinter
): DashboardPrinterStatus {
  switch (printer.availability) {
    case "Ready":
      return "idle";

    case "Busy":
      return "printing";

    case "Offline":
      return "offline";

    case "Error":
    case "PaperJam":
    case "PaperOut":
      return "attention";

    case "Unknown":
    default:
      return "idle";
  }
}

function getStatusMessage(
  printer: DashboardPrinter
): string {
  switch (printer.availability) {
    case "Ready":
      return "Printer ready";

    case "Busy":
      return "Printer is busy";

    case "Offline":
      return "Printer offline";

    case "Error":
      return "Printer error";

    case "PaperJam":
      return "Paper jam";

    case "PaperOut":
      return "Paper out";

    case "Unknown":
    default:
      return "Status unavailable";
  }
}

function isPrinterOnline(printer: DashboardPrinter): boolean {
  return (
    printer.availability !== "Offline" &&
    printer.availability !== "Error" &&
    printer.availability !== "PaperJam" &&
    printer.availability !== "PaperOut"
  );
}

function formatJobStatus(status: PrintJobRecord["status"]): string {
  switch (status) {
    case "queued":
      return "Queued";

    case "claimed":
      return "Claimed";

    case "downloading":
      return "Downloading";

    case "downloaded":
      return "Downloaded";

    case "printing":
      return "Printing";

    case "completed":
      return "Completed";

    case "failed":
      return "Failed";

    case "cancelled":
      return "Cancelled";

    default:
      return status;
  }
}

function formatDateTime(value?: string): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

export default function Dashboard() {
  const navigate = useNavigate();
  const { session } = useAuth();

  const [printers, setPrinters] = useState<DashboardPrinter[]>([]);
  const [jobs, setJobs] = useState<PrintJobRecord[]>([]);

  const [agent, setAgent] = useState<AgentState>({
    isConnected: false,
    realtimeConnected: false,
    mockCloudMode: false,
    queuedJobCount: 0,
  });

  const [loading, setLoading] = useState(true);

  const [filter, setFilter] = useState<
    "ALL" | "PRINTING" | "IDLE" | "ATTENTION"
  >("ALL");

  const [error, setError] = useState<string | null>(null);

  /* ------------------------------------------------------------------------ */
  /* Refresh real data                                                        */
  /* ------------------------------------------------------------------------ */

  const refreshData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      /*
       * These calls all go through:
       *
       * React
       *   -> src/lib/ipc.ts
       *   -> window.smartprinter.callAgent()
       *   -> Electron preload
       *   -> agent:call
       *   -> named pipe
       *   -> SmartPrinter.Agent
       *
       * This is the correct IPC path for the current application.
       */

      const [serviceStatus, discoveredPrinters, queue] =
        await Promise.all([
          getServiceStatus(),
          getPrinters(),
          getQueue(),
        ]);

      const status: ServiceStatusDto = serviceStatus;

      /*
       * A successful IPC response proves that the local agent is reachable.
       * realtimeConnected is kept separate because cloud realtime connectivity
       * is not the same thing as local Electron <-> Agent connectivity.
       */
      setAgent({
        isConnected: true,
        version: status.agentVersion,
        realtimeConnected: status.realtimeConnected,
        mockCloudMode: status.mockCloudMode,
        queuedJobCount: status.queuedJobCount,
      });

      /*
       * Map the real shared PrinterInfo contract into the small shape used
       * by this Dashboard.
       */
      const mappedPrinters: DashboardPrinter[] =
        discoveredPrinters.map((printer) => ({
          name: printer.name,
          driverName: printer.driverName,
          portName: printer.portName,
          isDefault: printer.isDefault,
          availability: printer.availability,
          fingerprint: printer.fingerprint,
        }));

      setPrinters(mappedPrinters);

      /*
       * GetQueue() returns the actual PrintJobRecord[] contract.
       */
      setJobs(queue);
    } catch (err) {
      console.error(
        "Failed to query SmartPrinter Agent:",
        err
      );

      /*
       * If IPC fails, the agent is genuinely unreachable from the UI.
       */
      setAgent((previous) => ({
        ...previous,
        isConnected: false,
      }));

      setError(
        err instanceof Error
          ? err.message
          : "Unable to communicate with SmartPrinter Agent."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  /* ------------------------------------------------------------------------ */
  /* Initial load + polling                                                   */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    void refreshData();

    const interval = window.setInterval(() => {
      void refreshData();
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, [refreshData]);

  /* ------------------------------------------------------------------------ */
  /* Derived values                                                           */
  /* ------------------------------------------------------------------------ */

  const totalPrinters = printers.length;

  const onlinePrinters = useMemo(() => {
    return printers.filter((printer) =>
      isPrinterOnline(printer)
    ).length;
  }, [printers]);

  const activeJobs = useMemo(() => {
    return jobs.filter(
      (job) =>
        job.status === "printing"
    );
  }, [jobs]);

  const queuedJobs = useMemo(() => {
    return jobs.filter(
      (job) =>
        job.status === "queued" ||
        job.status === "claimed" ||
        job.status === "downloading" ||
        job.status === "downloaded"
    );
  }, [jobs]);

  const attentionPrinters = useMemo(() => {
    return printers.filter((printer) => {
      const status = getPrinterStatus(printer);

      return (
        status === "attention" ||
        status === "error" ||
        status === "offline"
      );
    });
  }, [printers]);

  const filteredPrinters = useMemo(() => {
    switch (filter) {
      case "PRINTING":
        return printers.filter(
          (printer) =>
            getPrinterStatus(printer) === "printing"
        );

      case "IDLE":
        return printers.filter(
          (printer) =>
            getPrinterStatus(printer) === "idle"
        );

      case "ATTENTION":
        return attentionPrinters;

      case "ALL":
      default:
        return printers;
    }
  }, [printers, filter, attentionPrinters]);

  /* ------------------------------------------------------------------------ */
  /* Render                                                                   */
  /* ------------------------------------------------------------------------ */

  return (
    <div className="flex-1 overflow-y-auto bg-[#faf8ff] p-5 text-slate-800 lg:p-6">

      {/* ------------------------------------------------------------------ */}
      {/* Cloud / Agent status banner                                        */}
      {/* ------------------------------------------------------------------ */}

      {agent.isConnected && !agent.realtimeConnected && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-200 text-xs font-bold text-amber-800">
              !
            </span>

            <span className="font-semibold">
              Cloud Realtime Sync Paused:
            </span>

            <span>
              Desktop agent is running locally.
              {agent.mockCloudMode
                ? " Cloud mock/offline mode is enabled."
                : " Jobs will continue through the local queue."}
            </span>
          </div>

          <Link
            to="/diagnostics"
            className="text-xs font-semibold text-amber-800 underline hover:text-amber-950"
          >
            Diagnostics &amp; Logs →
          </Link>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Communication error                                                */}
      {/* ------------------------------------------------------------------ */}

      {error && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 shadow-sm">
          <div>
            <span className="font-semibold">
              SmartPrinter Agent unavailable:
            </span>{" "}
            {error}
          </div>

          <button
            type="button"
            onClick={() => void refreshData()}
            disabled={loading}
            className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Hardware attention banner                                          */}
      {/* ------------------------------------------------------------------ */}

      {attentionPrinters.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-200 text-xs font-bold text-amber-800">
              !
            </span>

            <span className="font-semibold">
              Hardware Attention:
            </span>

            <span>
              {attentionPrinters.length} printer
              {attentionPrinters.length > 1 ? "s" : ""} require
              attention.
            </span>
          </div>

          <Link
            to="/printers/status"
            className="text-xs font-semibold text-amber-800 underline hover:text-amber-950"
          >
            View Printers →
          </Link>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Header                                                              */}
      {/* ------------------------------------------------------------------ */}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <span>
              {session?.user?.email || "Local Terminal"}
            </span>

            <span>•</span>

            <span className="flex items-center gap-1.5">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  agent.isConnected
                    ? "bg-emerald-500"
                    : "bg-rose-500"
                }`}
              />

              Agent{" "}
              {agent.isConnected
                ? "Connected"
                : "Disconnected"}

              {agent.version && (
                <span className="font-mono text-[11px]">
                  · {agent.version}
                </span>
              )}
            </span>
          </div>

          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 lg:text-2xl">
            System Overview
          </h1>
        </div>

        {/* Operational Actions */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => void refreshData()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ↻{" "}
            {loading
              ? "Scanning..."
              : "Discover Printers"}
          </button>

          <button
            type="button"
            onClick={() => navigate("/diagnostics")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            Run Diagnostics
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Metrics                                                             */}
      {/* ------------------------------------------------------------------ */}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">

        {/* Printers Online */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Printers Online
          </p>

          <div className="mt-2 flex items-baseline justify-between gap-3">
            {loading && totalPrinters === 0 ? (
              <span className="text-sm text-slate-400">
                Querying spooler...
              </span>
            ) : totalPrinters > 0 ? (
              <>
                <span className="text-2xl font-bold text-slate-900">
                  {onlinePrinters}
                  <span className="text-base font-normal text-slate-400">
                    {" "}
                    / {totalPrinters}
                  </span>
                </span>

                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                  {Math.round(
                    (onlinePrinters / totalPrinters) * 100
                  )}
                  % Available
                </span>
              </>
            ) : (
              <span className="text-sm text-slate-500">
                No printers detected
              </span>
            )}
          </div>
        </div>

        {/* Active Printing */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Active Spooling
          </p>

          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900">
              {activeJobs.length} Jobs
            </span>

            {activeJobs.length > 0 && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                Live Spool
              </span>
            )}
          </div>
        </div>

        {/* Queue */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Queued Jobs
          </p>

          <div className="mt-2 flex items-baseline justify-between gap-3">
            <span className="text-2xl font-bold text-slate-900">
              {queuedJobs.length} In Queue
            </span>

            <span className="text-xs text-slate-500">
              {queuedJobs.length === 0
                ? "Buffer Empty"
                : "Buffer Active"}
            </span>
          </div>
        </div>

        {/* Agent */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Spooler Bridge
          </p>

          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  agent.isConnected
                    ? "bg-emerald-500"
                    : "bg-rose-500"
                }`}
              />

              <span className="text-base font-bold text-slate-900">
                {agent.isConnected
                  ? "Active"
                  : "Offline"}
              </span>
            </div>

            <span className="font-mono text-[11px] text-slate-400">
              IPC Pipe
            </span>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Main split                                                          */}
      {/* ------------------------------------------------------------------ */}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* ================================================================ */}
        {/* Left: Printers                                                    */}
        {/* ================================================================ */}

        <div className="space-y-4 lg:col-span-2">

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Connected Printers
              </h2>

              <p className="text-xs text-slate-500">
                Real-time spool status &amp; printer information
              </p>
            </div>

            <div className="flex rounded-lg border border-slate-200 bg-white p-1 text-xs font-medium">
              {(
                [
                  "ALL",
                  "PRINTING",
                  "IDLE",
                  "ATTENTION",
                ] as const
              ).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setFilter(tab)}
                  className={`rounded px-3 py-1 capitalize transition-colors ${
                    filter === tab
                      ? "bg-emerald-600 font-semibold text-white"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {tab.toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Printer list */}
          {filteredPrinters.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-lg">
                🖨️
              </div>

              <p className="text-sm font-medium text-slate-700">
                {loading
                  ? "Discovering Windows printers..."
                  : totalPrinters === 0
                  ? "No printers detected."
                  : "No printers found matching this filter."}
              </p>

              {!loading && (
                <Link
                  to="/printers"
                  className="mt-2 inline-block text-xs font-semibold text-emerald-600 hover:underline"
                >
                  Run Discovery Scan →
                </Link>
              )}
            </div>
          ) : (
            filteredPrinters.map((printer) => {
              const printerStatus =
                getPrinterStatus(printer);

              const isOffline =
                printerStatus === "offline";

              const currentJob = jobs.find(
                (job) =>
                  job.printerId === printer.name &&
                  job.status === "printing"
              );

              /*
               * Some jobs may identify the printer by a backend/device ID
               * instead of its Windows name. Therefore also check printerName.
               */
              const currentJobByName =
                currentJob ||
                jobs.find(
                  (job) =>
                    job.printerName === printer.name &&
                    job.status === "printing"
                );

              return (
                <div
                  key={`${printer.name}-${printer.fingerprint}`}
                  className={`rounded-xl border bg-white p-4 shadow-sm transition-all ${
                    isOffline
                      ? "border-rose-200 bg-rose-50/20"
                      : printerStatus === "attention"
                      ? "border-amber-200 bg-amber-50/20"
                      : "border-slate-200"
                  }`}
                >
                  {/* Printer header */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">

                      {/* Printer icon */}
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-lg">
                        🖨️
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-bold text-slate-900">
                            {printer.name}
                          </h3>

                          {printer.isDefault && (
                            <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                              Default
                            </span>
                          )}
                        </div>

                        <p className="mt-1 truncate text-xs text-slate-500">
                          Driver:{" "}
                          <span className="text-slate-700">
                            {printer.driverName ||
                              "Unknown"}
                          </span>
                        </p>

                        <p className="truncate text-xs text-slate-500">
                          Port:{" "}
                          <span className="font-mono text-slate-700">
                            {printer.portName ||
                              "Unknown"}
                          </span>
                        </p>
                      </div>
                    </div>

                    {/* Status */}
                    <span
                      className={`shrink-0 rounded px-2.5 py-0.5 text-xs font-semibold uppercase ${
                        printerStatus === "printing"
                          ? "bg-emerald-100 text-emerald-800"
                          : printerStatus === "offline"
                          ? "bg-rose-100 text-rose-800"
                          : printerStatus === "attention"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {printer.availability}
                    </span>
                  </div>

                  {/* Printer status message */}
                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                    <span className="text-[11px] text-slate-500">
                      {getStatusMessage(printer)}
                    </span>

                    <span className="font-mono text-[10px] text-slate-400">
                      {printer.fingerprint
                        ? printer.fingerprint.slice(
                            0,
                            12
                          )
                        : "No fingerprint"}
                    </span>
                  </div>

                  {/* Active job */}
                  {currentJobByName && (
                    <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
                      <div className="flex items-center justify-between gap-3 font-medium text-slate-800">
                        <span className="truncate">
                          Print Job{" "}
                          {currentJobByName.printJobId.slice(
                            0,
                            8
                          )}
                        </span>

                        <span className="shrink-0 rounded bg-white px-2 py-0.5 font-mono text-[10px] uppercase text-emerald-700">
                          {formatJobStatus(
                            currentJobByName.status
                          )}
                        </span>
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-500">
                        <span>
                          Printer:{" "}
                          <strong className="text-slate-700">
                            {currentJobByName.printerName ||
                              printer.name}
                          </strong>
                        </span>

                        <span>
                          Spooler Job:{" "}
                          <strong className="text-slate-700">
                            {currentJobByName.spoolerJobId ??
                              "Pending"}
                          </strong>
                        </span>

                        <span>
                          Retries:{" "}
                          <strong className="text-slate-700">
                            {currentJobByName.retryCount}
                          </strong>
                        </span>

                        <span>
                          Started:{" "}
                          <strong className="text-slate-700">
                            {formatDateTime(
                              currentJobByName.printedAt ||
                                currentJobByName.updatedAt
                            )}
                          </strong>
                        </span>
                      </div>

                      {currentJobByName.lastError && (
                        <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">
                          {currentJobByName.lastError}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* ================================================================ */}
        {/* Right: Queue + Operations                                        */}
        {/* ================================================================ */}

        <div className="space-y-6">

          {/* Active Print Queue */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">
                Active Print Queue
              </h2>

              <Link
                to="/jobs/active"
                className="text-xs font-semibold text-emerald-600 hover:underline"
              >
                View All ({jobs.length}) →
              </Link>
            </div>

            {jobs.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">
                Queue is currently empty.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {jobs.slice(0, 5).map((job) => (
                  <div
                    key={job.printJobId}
                    className="flex items-center justify-between gap-3 py-2.5 text-xs"
                  >
                    <div className="min-w-0 truncate pr-3">
                      <p className="truncate font-semibold text-slate-800">
                        Job{" "}
                        {job.printJobId.slice(0, 8)}
                      </p>

                      <p className="truncate text-[11px] text-slate-400">
                        {job.printerName ||
                          "Target Printer"}
                      </p>

                      {job.spoolerJobId != null && (
                        <p className="text-[10px] text-slate-400">
                          Spooler #{job.spoolerJobId}
                        </p>
                      )}
                    </div>

                    <span
                      className={`shrink-0 rounded px-2 py-0.5 font-mono text-[10px] uppercase ${
                        job.status === "printing"
                          ? "bg-emerald-100 text-emerald-700"
                          : job.status === "failed"
                          ? "bg-rose-100 text-rose-700"
                          : job.status === "completed"
                          ? "bg-slate-100 text-slate-500"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {job.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Operations */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-bold text-slate-900">
              Quick Operations
            </h2>

            <div className="grid grid-cols-2 gap-2 text-xs font-semibold">

              {/* Add Printer */}
              <button
                type="button"
                onClick={() => navigate("/printers")}
                className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-slate-800 transition hover:bg-slate-100"
              >
                <span className="mb-1 text-base">
                  🔍
                </span>

                <span>Add Printer</span>
              </button>

              {/* QR Pairing */}
              <button
                type="button"
                onClick={() => navigate("/qr")}
                className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-slate-800 transition hover:bg-slate-100"
              >
                <span className="mb-1 text-base">
                  📱
                </span>

                <span>QR Pairing</span>
              </button>

              {/* Diagnostics */}
              <button
                type="button"
                onClick={() =>
                  navigate("/diagnostics")
                }
                className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-slate-800 transition hover:bg-slate-100"
              >
                <span className="mb-1 text-base">
                  🛠️
                </span>

                <span>Diagnostics</span>
              </button>

              {/* Settings */}
              <button
                type="button"
                onClick={() =>
                  navigate("/settings")
                }
                className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-slate-800 transition hover:bg-slate-100"
              >
                <span className="mb-1 text-base">
                  ⚙️
                </span>

                <span>Settings</span>
              </button>
            </div>
          </div>

          {/* Agent details */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-bold text-slate-900">
              Agent Status
            </h2>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">
                  Local IPC
                </span>

                <span
                  className={`font-semibold ${
                    agent.isConnected
                      ? "text-emerald-600"
                      : "text-rose-600"
                  }`}
                >
                  {agent.isConnected
                    ? "Connected"
                    : "Disconnected"}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-500">
                  Agent Version
                </span>

                <span className="font-mono text-slate-700">
                  {agent.version || "—"}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-500">
                  Cloud Realtime
                </span>

                <span
                  className={`font-semibold ${
                    agent.realtimeConnected
                      ? "text-emerald-600"
                      : "text-amber-600"
                  }`}
                >
                  {agent.realtimeConnected
                    ? "Connected"
                    : "Offline"}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-500">
                  Cloud Mode
                </span>

                <span className="font-semibold text-slate-700">
                  {agent.mockCloudMode
                    ? "Mock / Offline"
                    : "Live"}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-500">
                  Queue
                </span>

                <span className="font-semibold text-slate-700">
                  {agent.queuedJobCount}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}