import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  PrinterInfo,
  PrintJobRecord,
  ServiceStatusDto,
} from "../../../../packages/shared-contracts/src";

import {
  getServiceStatus,
  getPrinters,
  getJobs,
  printTestPage,
} from "../lib/ipc";

interface TestPageProgress {
  printerName: string;
  status: "idle" | "submitting" | "success" | "error";
  message?: string;
}

type AvailabilityFilter =
  | "ALL"
  | "READY"
  | "BUSY"
  | "OFFLINE"
  | "ATTENTION";

export default function PrinterDiscovery() {
  const navigate = useNavigate();

  // ---------------------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------------------

  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [activeJobs, setActiveJobs] = useState<PrintJobRecord[]>([]);

  const [serviceStatus, setServiceStatus] = useState<ServiceStatusDto>({
    isPaired: false,
    realtimeConnected: false,
    mockCloudMode: false,
    agentVersion: "unknown",
    queuedJobCount: 0,
  });

  const [loading, setLoading] = useState<boolean>(true);
  const [discovering, setDiscovering] = useState<boolean>(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] =
    useState<AvailabilityFilter>("ALL");

  const [testPrintState, setTestPrintState] = useState<
    Record<string, TestPageProgress>
  >({});

  // ---------------------------------------------------------------------------
  // PRINTER DISCOVERY
  //
  // IMPORTANT:
  // Do NOT use window.electron.ipcRenderer here.
  // All renderer -> Electron -> .NET communication goes through ../lib/ipc.
  // ---------------------------------------------------------------------------

  const discoverPrinters = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) {
        setDiscovering(true);
      }

      setDiscoveryError(null);

      try {
        // Get the current desktop-agent/service status.
        const status = await getServiceStatus();
        setServiceStatus(status);

        // Get printers from the Windows Win32 spooler through the .NET agent.
        const discoveredPrinters = await getPrinters();
        setPrinters(discoveredPrinters);

        // Get active/queued jobs.
        const jobs = await getJobs();
        setActiveJobs(jobs);
      } catch (err: unknown) {
        console.error(
          "[PrinterDiscovery] Win32 spooler enumeration failed:",
          err
        );

        const message =
          err instanceof Error
            ? err.message
            : "Failed to communicate with local Win32 spooler agent.";

        setDiscoveryError(message);
      } finally {
        setLoading(false);
        setDiscovering(false);
      }
    },
    []
  );

  // Initial discovery + periodic refresh.
  useEffect(() => {
    void discoverPrinters();

    const interval = window.setInterval(() => {
      void discoverPrinters(false);
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, [discoverPrinters]);

  // ---------------------------------------------------------------------------
  // TEST PRINT
  // ---------------------------------------------------------------------------

  const handlePrintTestPage = async (printerName: string) => {
    const trimmedPrinterName = printerName?.trim();

    if (!trimmedPrinterName) {
      console.error("[PrinterDiscovery] Printer name is empty.");
      return;
    }

    setTestPrintState((prev) => ({
      ...prev,
      [trimmedPrinterName]: {
        printerName: trimmedPrinterName,
        status: "submitting",
        message: "Dispatching test page to spooler...",
      },
    }));

    try {
      console.log(
        "[PrinterDiscovery] Sending test page to:",
        trimmedPrinterName
      );

      // IMPORTANT:
      // This goes through src/lib/ipc.ts ->
      // window.smartprinter.callAgent() ->
      // Electron main process ->
      // named pipe ->
      // .NET SmartPrinter.Agent.
      await printTestPage({
        printerName: trimmedPrinterName,
      });

      console.log(
        "[PrinterDiscovery] Test page request accepted for:",
        trimmedPrinterName
      );

      setTestPrintState((prev) => ({
        ...prev,
        [trimmedPrinterName]: {
          printerName: trimmedPrinterName,
          status: "success",
          message: "Test page spooled successfully.",
        },
      }));

      // Refresh printer/job information after printing.
      void discoverPrinters(false);
    } catch (err: unknown) {
      console.error(
        "[PrinterDiscovery] Print test page failed:",
        err
      );

      const message =
        err instanceof Error
          ? err.message
          : "Failed to submit test page.";

      setTestPrintState((prev) => ({
        ...prev,
        [trimmedPrinterName]: {
          printerName: trimmedPrinterName,
          status: "error",
          message,
        },
      }));
    } finally {
      window.setTimeout(() => {
        setTestPrintState((prev) => {
          const updated = { ...prev };
          delete updated[trimmedPrinterName];
          return updated;
        });
      }, 5000);
    }
  };

  // ---------------------------------------------------------------------------
  // METRICS
  // ---------------------------------------------------------------------------

  const totalCount = printers.length;

  const readyCount = useMemo(
    () =>
      printers.filter(
        (printer) => printer.availability === "Ready"
      ).length,
    [printers]
  );

  const busyCount = useMemo(
    () =>
      printers.filter(
        (printer) => printer.availability === "Busy"
      ).length,
    [printers]
  );

  const attentionPrinters = useMemo(
    () =>
      printers.filter(
        (printer) =>
          printer.availability === "Offline" ||
          printer.availability === "Error" ||
          printer.availability === "PaperJam" ||
          printer.availability === "PaperOut"
      ),
    [printers]
  );

  // ---------------------------------------------------------------------------
  // FILTERING
  // ---------------------------------------------------------------------------

  const filterTabs: {
    id: AvailabilityFilter;
    label: string;
  }[] = [
    { id: "ALL", label: `All (${totalCount})` },
    { id: "READY", label: `Ready (${readyCount})` },
    { id: "BUSY", label: `Busy (${busyCount})` },
    {
      id: "ATTENTION",
      label: `Attention (${attentionPrinters.length})`,
    },
    { id: "OFFLINE", label: "Offline" },
  ];

  const filteredPrinters = useMemo(() => {
    return printers.filter((printer) => {
      const q = searchQuery.trim().toLowerCase();

      const matchesSearch =
        q === "" ||
        printer.name.toLowerCase().includes(q) ||
        printer.driverName.toLowerCase().includes(q) ||
        printer.portName.toLowerCase().includes(q) ||
        printer.fingerprint.toLowerCase().includes(q);

      if (!matchesSearch) {
        return false;
      }

      if (statusFilter === "READY") {
        return printer.availability === "Ready";
      }

      if (statusFilter === "BUSY") {
        return printer.availability === "Busy";
      }

      if (statusFilter === "OFFLINE") {
        return printer.availability === "Offline";
      }

      if (statusFilter === "ATTENTION") {
        return (
          printer.availability === "Error" ||
          printer.availability === "PaperJam" ||
          printer.availability === "PaperOut"
        );
      }

      return true;
    });
  }, [printers, searchQuery, statusFilter]);

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  return (
    <div className="flex-1 overflow-y-auto bg-[#faf8ff] p-5 lg:p-6 text-slate-800">
      {/* ------------------------------------------------------------------- */}
      {/* AGENT / REALTIME STATUS BANNER                                      */}
      {/* ------------------------------------------------------------------- */}

      {!serviceStatus.realtimeConnected && !loading && (
        <div className="mb-5 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-200 font-bold text-amber-800">
              !
            </span>

            <span className="font-semibold">
              Cloud Realtime Sync Paused:
            </span>

            <span>
              Desktop agent is running in local offline queue mode.
              Jobs will buffer in SQLite until reconnect.
            </span>
          </div>

          <Link
            to="/diagnostics"
            className="font-semibold text-amber-800 underline hover:text-amber-950"
          >
            Diagnostics &amp; Logs →
          </Link>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* HEADER                                                              */}
      {/* ------------------------------------------------------------------- */}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <span>Win32 Subsystem</span>

            <span>•</span>

            <span className="flex items-center gap-1.5 font-mono text-[11px]">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  serviceStatus.realtimeConnected
                    ? "bg-emerald-500"
                    : "bg-emerald-600"
                }`}
              />

              Agent: v{serviceStatus.agentVersion || "2.4.1"}

              {serviceStatus.deviceId &&
                ` (${serviceStatus.deviceId.slice(0, 8)})`}
            </span>
          </div>

          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 lg:text-2xl">
            Printers &amp; Discovery
          </h1>

          <p className="mt-0.5 text-xs text-slate-500">
            Local Win32 print subsystem &amp; authorized fleet routing
            coordinator
          </p>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => navigate("/diagnostics")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 active:bg-slate-100"
          >
            Spooler Diagnostics
          </button>

          <button
            type="button"
            onClick={() => void discoverPrinters(true)}
            disabled={discovering}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50"
          >
            ↻ {discovering ? "Discovering..." : "Discover / Rescan Fleet"}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* KPI CARDS                                                           */}
      {/* ------------------------------------------------------------------- */}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Total */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Total Detected
          </p>

          <p className="mt-1 text-2xl font-bold text-slate-900">
            {loading ? "..." : totalCount}
          </p>

          <p className="mt-0.5 text-[11px] font-medium text-emerald-600">
            Win32 drivers loaded
          </p>
        </div>

        {/* Fleet Availability */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Fleet Availability
          </p>

          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">
              {loading ? "..." : readyCount}
            </span>

            <span className="text-xs text-slate-500">
              / {totalCount} Active
            </span>

            {totalCount > 0 && (
              <span className="text-xs font-semibold text-emerald-600">
                {Math.round((readyCount / totalCount) * 100)}%
              </span>
            )}
          </div>
        </div>

        {/* Active Jobs */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Active Spool Jobs
          </p>

          <p className="mt-1 text-2xl font-bold text-slate-900">
            {loading
              ? "..."
              : activeJobs.length || serviceStatus.queuedJobCount}
          </p>

          <p className="mt-0.5 text-[11px] font-medium text-slate-400">
            Local SQLite queue streaming
          </p>
        </div>

        {/* Attention */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Attention Required
          </p>

          <p
            className={`mt-1 text-2xl font-bold ${
              attentionPrinters.length > 0
                ? "text-amber-600"
                : "text-slate-900"
            }`}
          >
            {loading ? "..." : attentionPrinters.length}
          </p>

          <p className="mt-0.5 text-[11px] font-medium text-slate-400">
            {attentionPrinters.length === 0
              ? "All ports responsive"
              : "Review offline/jammed ports"}
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* SEARCH + FILTER                                                     */}
      {/* ------------------------------------------------------------------- */}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm">
        <div className="relative min-w-[240px] flex-1">
          <span className="absolute left-3 top-2.5 text-xs text-slate-400">
            🔍
          </span>

          <input
            type="text"
            placeholder="Search printers by name, driver, port, or fingerprint..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50/50 py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        <div className="flex rounded-lg border border-slate-200 bg-slate-50/70 p-1 text-xs font-medium">
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`rounded px-3 py-1 transition-colors ${
                statusFilter === tab.id
                  ? "bg-emerald-600 font-semibold text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* PRINTER LIST                                                        */}
      {/* ------------------------------------------------------------------- */}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-xs text-slate-400">
          <div className="mb-2 inline-block h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />

          <p>
            Enumerating Win32 print subsystem via Named Pipe...
          </p>
        </div>
      ) : discoveryError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-8 text-center text-xs text-rose-800">
          <p className="mb-1 text-sm font-semibold">
            Win32 Subsystem Communication Error
          </p>

          <p className="mb-3 text-rose-600">
            {discoveryError}
          </p>

          <button
            type="button"
            onClick={() => void discoverPrinters(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3.5 py-1.5 font-semibold text-rose-700 shadow-sm hover:bg-rose-50"
          >
            Retry Enumeration
          </button>
        </div>
      ) : filteredPrinters.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-slate-700">
            {searchQuery
              ? "No matching printers found"
              : "No Printers Attached"}
          </p>

          <p className="mt-1 text-xs text-slate-500">
            {searchQuery
              ? `No installed printers match "${searchQuery}".`
              : "Verify physical USB or network printer connections in Windows Devices and Printers."}
          </p>

          <div className="mt-4 flex justify-center gap-2">
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Clear Search
              </button>
            )}

            <button
              type="button"
              onClick={() => void discoverPrinters(true)}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              Scan Subsystem
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3.5">
          {filteredPrinters.map((printer: PrinterInfo) => {
            const currentJob = activeJobs.find(
              (job) =>
                job.printerName === printer.name &&
                (job.status === "printing" ||
                  job.status === "claimed")
            );

            const isOffline =
              printer.availability === "Offline";

            const isError =
              printer.availability === "Error" ||
              printer.availability === "PaperJam" ||
              printer.availability === "PaperOut";

            const testState =
              testPrintState[printer.name];

            return (
              <div
                key={printer.fingerprint || printer.name}
                className={`rounded-xl border bg-white p-4 shadow-sm transition-all ${
                  isOffline
                    ? "border-rose-200 bg-rose-50/15"
                    : isError
                    ? "border-amber-200 bg-amber-50/15"
                    : "border-slate-200/90"
                }`}
              >
                {/* Printer Header */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {/* Identity */}
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-base">
                      🖨️
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-bold text-slate-900">
                          {printer.name}
                        </h2>

                        {printer.isDefault && (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                            DEFAULT
                          </span>
                        )}

                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                          {printer.supportsColor
                            ? "Color"
                            : "Mono"}
                        </span>

                        {printer.supportsDuplex && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                            Duplex
                          </span>
                        )}
                      </div>

                      <p className="mt-0.5 font-mono text-xs text-slate-400">
                        Driver: {printer.driverName} • Port:{" "}
                        {printer.portName}
                      </p>

                      <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                        Fingerprint:{" "}
                        <span className="text-slate-600">
                          {printer.fingerprint}
                        </span>
                      </p>
                    </div>
                  </div>

                  {/* Availability + Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-2.5 py-0.5 text-xs font-semibold uppercase ${
                        printer.availability === "Ready"
                          ? "bg-emerald-100 text-emerald-800"
                          : printer.availability === "Busy"
                          ? "bg-blue-100 text-blue-800"
                          : isOffline
                          ? "bg-rose-100 text-rose-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {printer.availability}
                    </span>

                    {/* Print Test Page */}
                    <button
                      type="button"
                      onClick={() =>
                        void handlePrintTestPage(printer.name)
                      }
                      disabled={
                        testState?.status === "submitting" ||
                        isOffline
                      }
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50"
                    >
                      {testState?.status === "submitting"
                        ? "Sending..."
                        : "Print Test Page"}
                    </button>

                    {/* Configure / Status */}
                    <button
                      type="button"
                      onClick={() =>
                        navigate(
                          `/printers/status?target=${encodeURIComponent(
                            printer.name
                          )}`
                        )
                      }
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50"
                    >
                      Configure / Status →
                    </button>
                  </div>
                </div>

                {/* Test Print Status */}
                {testState &&
                  testState.status !== "idle" && (
                    <div
                      className={`mt-3 rounded-lg border px-3 py-1.5 text-xs ${
                        testState.status === "success"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : testState.status === "error"
                          ? "border-rose-200 bg-rose-50 text-rose-800"
                          : "border-slate-200 bg-slate-50 text-slate-600"
                      }`}
                    >
                      {testState.message}
                    </div>
                  )}

                {/* Active Job */}
                {currentJob ? (
                  <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
                    <div className="flex items-center justify-between font-medium text-slate-800">
                      <span className="truncate font-mono">
                        Active Job: #
                        {currentJob.spoolerJobId ||
                          currentJob.printJobId.slice(0, 8)}{" "}
                        (Status: {currentJob.status})
                      </span>

                      <span className="text-[11px] text-slate-500">
                        Retries: {currentJob.retryCount}
                      </span>
                    </div>
                  </div>
                ) : (
                  !isOffline &&
                  !isError && (
                    <div className="mt-2 text-[11px] text-slate-400">
                      Queue: Idle • Spooler channel active
                    </div>
                  )
                )}

                {/* Offline / Error Diagnostic */}
                {(isOffline || isError) && (
                  <div className="mt-3 flex items-center justify-between text-xs text-rose-700">
                    <span>
                      {isOffline
                        ? "Windows print spooler reports printer port unreachable. Verify physical connection."
                        : `Subsystem alert: ${printer.availability}. Check device control panel.`}
                    </span>

                    <Link
                      to="/diagnostics"
                      className="font-semibold underline hover:text-rose-900"
                    >
                      Diagnostic Logs →
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}