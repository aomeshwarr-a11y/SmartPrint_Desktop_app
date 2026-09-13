import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { PrinterInfo, ServiceStatusDto, PrintJobRecord } from "@shared/index";
import {
  getServiceStatus,
  getPrinters,
  getJobs,
  printTestPage,
  exportDiagnostics,
} from "../lib/ipc";

interface PrinterTelemetryData extends PrinterInfo {
  status?: string;
  isOnline?: boolean;
}

export default function PrinterStatusPage() {
  const [searchParams] = useSearchParams();
  const targetPrinterName = searchParams.get("target");

  const [serviceStatus, setServiceStatus] = useState<ServiceStatusDto | null>(null);
  const [hardwareFleet, setHardwareFleet] = useState<PrinterTelemetryData[]>([]);
  const [activeJobs, setActiveJobs] = useState<PrintJobRecord[]>([]);

  const [testPrintFeedback, setTestPrintFeedback] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Poll real printer/service/job data from the desktop agent.
  const fetchTelemetry = useCallback(async () => {
    setRefreshing(true);
    try {
      const [statusRes, printersRes, jobsRes] = await Promise.all([
        getServiceStatus().catch(() => null),
        getPrinters().catch(() => [] as PrinterInfo[]),
        getJobs().catch(() => [] as PrintJobRecord[]),
      ]);

      setServiceStatus(statusRes);
      setHardwareFleet(
        printersRes.map((p) => ({
          ...p,
          status: p.availability === "Ready" ? "Ready" : "Offline",
          isOnline: p.availability === "Ready",
        }))
      );
      setActiveJobs(jobsRes);
    } catch (err) {
      console.warn("Hardware telemetry IPC invocation failed:", err);
      setServiceStatus(null);
      setHardwareFleet([]);
      setActiveJobs([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 6000);
    return () => clearInterval(interval);
  }, [fetchTelemetry]);

  // Dispatch Win32 Test Page
  const handlePrintTest = async (printerName: string) => {
    setTestPrintFeedback(`Submitting test page to ${printerName}...`);
    try {
      await printTestPage({ printerName });
      setTestPrintFeedback(`Test page spooled successfully to ${printerName}.`);
    } catch (err: any) {
      setTestPrintFeedback(err?.message || "Failed to trigger test print");
    } finally {
      setTimeout(() => setTestPrintFeedback(null), 4000);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#faf8ff] p-5 lg:p-6 text-slate-800 font-sans select-none">
      {/* 1. OPERATIONAL TELEMETRY HEADER */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <span className="font-semibold text-emerald-700 flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Win32 Hardware Subsystem
            </span>
            <span>•</span>
            <span>winspool.drv Subsystem</span>
            <span>•</span>
            <span className="font-mono text-[11px]">
              Agent {serviceStatus?.agentVersion ? `v${serviceStatus.agentVersion}` : "Offline"}
            </span>
            <span>•</span>
            <span className="font-mono text-[11px] text-slate-400">
              IPC: {serviceStatus ? "Connected (Named Pipe)" : "Disconnected"}
            </span>
          </div>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 lg:text-2xl">
            Printer Fleet Status &amp; Hardware Telemetry
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Real-time port inspection, capabilities, and spooler driver diagnostics across local Win32 instances.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              const printer = hardwareFleet[0];
              if (printer) {
                handlePrintTest(printer.name);
              } else {
                setTestPrintFeedback("No printer is currently available.");
                setTimeout(() => setTestPrintFeedback(null), 4000);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 active:bg-emerald-800 transition cursor-pointer"
          >
            🖨️ Print Test Page (IPC)
          </button>
          <button
            type="button"
            onClick={() =>
              setTestPrintFeedback("Spooler queue flush is not available through the current desktop IPC contract.")
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition"
          >
            🗑️ Spooler Queue Flush
          </button>
          <button
            type="button"
            onClick={fetchTelemetry}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition"
            title="Refresh hardware metrics"
          >
            ↻ {refreshing ? "Polling..." : "Refresh Telemetry"}
          </button>
        </div>
      </div>

      {testPrintFeedback && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800 font-medium shadow-xs">
          {testPrintFeedback}
        </div>
      )}

      {/* 2. FLEET HEALTH SUMMARY CARDS */}
      <div className="mb-6 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Online &amp; Responsive
            </span>
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 font-bold text-xs">
              🛡️
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-slate-900">
              {hardwareFleet.filter((p) => p.isOnline).length} / {hardwareFleet.length}
            </span>
            <span className="text-xs font-semibold text-emerald-600">
              {hardwareFleet.length > 0
                ? `${Math.round(
                    (hardwareFleet.filter((p) => p.isOnline).length / hardwareFleet.length) * 100
                  )}% Operational`
                : "No telemetry"}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            {hardwareFleet.length > 0
              ? `${hardwareFleet.filter((p) => !p.isOnline).length} offline units detected`
              : "No printer telemetry available"}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Win32 Spooler Pipe
            </span>
            <span className="text-base">⚡</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {serviceStatus ? "Connected" : "Offline"}
          </p>
          <p className="mt-1 font-mono text-[11px] text-emerald-600 font-semibold">
            {serviceStatus ? "Named Pipe Active" : "Service not responding"}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Color Capability
            </span>
            <span className="text-base">🎨</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {hardwareFleet.filter((p) => p.supportsColor).length} / {hardwareFleet.length}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {hardwareFleet.filter((p) => p.supportsColor).length > 0
              ? `${hardwareFleet.filter((p) => p.supportsColor).length} Color enabled queues`
              : "All queues monochrome"}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Active Agent Jobs
            </span>
            <span className="text-base">📦</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {activeJobs.length}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {activeJobs.filter((j) => j.status === "printing").length} actively printing
          </p>
        </div>
      </div>

      {/* 3. HARDWARE DEEP DIVE FLEET LIST */}
      <div className="space-y-4">
        {hardwareFleet.map((printer) => {
          const isTargeted = targetPrinterName === printer.name;
          const isReady = printer.isOnline;

          return (
            <div
              key={printer.name}
              className={`rounded-2xl border bg-white p-5 shadow-xs transition-all ${
                isTargeted ? "ring-2 ring-emerald-500 border-emerald-500" : "border-slate-200/90"
              }`}
            >
              {/* Header: Identity, Tags & Primary Triggers */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <div className="flex items-start gap-3.5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-50 border border-slate-200 text-xl">
                    🖨️
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-slate-900">{printer.name}</h2>
                      {printer.isDefault && (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                          DEFAULT
                        </span>
                      )}
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 uppercase font-mono">
                        {printer.supportsColor ? "Color" : "Monochrome"}
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono text-xs text-slate-400">
                      Port: <span className="text-slate-700 font-semibold">{printer.portName || "Local"}</span> •
                      Fingerprint: <span className="text-slate-500">{printer.fingerprint || "Unavailable"}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${
                      isReady ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                    }`}
                  >
                    ● {isReady ? "Ready" : "Offline"}
                  </span>
                  <button
                    type="button"
                    onClick={() => handlePrintTest(printer.name)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition"
                  >
                    Test Page
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePrintTest(printer.name)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition"
                  >
                    Verify Spooler
                  </button>
                </div>
              </div>

              {/* Middle: 3-Column Metrics Breakdown */}
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
                {/* Consumables & Capabilities */}
                <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3.5">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-2.5">
                    <span>Print Capabilities</span>
                    <span className="font-mono text-[10px] text-emerald-600 font-semibold">
                      {printer.supportsColor ? "Full Color" : "Monochrome"}
                    </span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>Color Printing:</span>
                      <span className="font-semibold text-slate-800">{printer.supportsColor ? "Supported" : "No"}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Duplex Printing:</span>
                      <span className="font-semibold text-slate-800">{printer.supportsDuplex ? "Supported" : "Simplex Only"}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Default System Queue:</span>
                      <span className="font-semibold text-slate-800">{printer.isDefault ? "Yes" : "No"}</span>
                    </div>
                  </div>
                </div>

                {/* Port & Connection */}
                <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3.5">
                  <div className="text-xs font-bold text-slate-700 mb-2.5">
                    Port &amp; Hardware Connection
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>Port Name:</span>
                      <span className="font-mono font-semibold text-slate-800">{printer.portName || "Local"}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Port Type:</span>
                      <span className="font-semibold text-slate-800">
                        {printer.portName?.toUpperCase().includes("USB")
                          ? "USB Port"
                          : printer.portName?.toUpperCase().includes("IP") || printer.portName?.includes(".")
                          ? "Standard TCP/IP Network"
                          : "Virtual / Spooler Port"}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Driver Fingerprint:</span>
                      <span className="font-mono text-[10px] text-slate-500 truncate max-w-[150px]">
                        {printer.fingerprint || "Unavailable"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Spooler & Hardware Telemetry */}
                <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3.5">
                  <div className="text-xs font-bold text-slate-700 mb-2.5">
                    Win32 Driver &amp; Spooler Status
                  </div>
                  <div className="space-y-1.5 font-mono text-[11px] text-slate-600">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Driver:</span>
                      <span className="truncate max-w-[170px] text-slate-800 font-semibold">{printer.driverName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Availability Code:</span>
                      <span className="text-slate-800">{printer.availability}</span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-slate-200/60">
                      <span className="text-slate-400">Queued Agent Jobs:</span>
                      <span className="text-slate-800 font-semibold">
                        {activeJobs.filter((j) => {
                          try {
                            if (j.optionsJson) {
                              const parsed = JSON.parse(j.optionsJson);
                              return parsed.printerName === printer.name;
                            }
                          } catch {
                            // ignore json parse errors
                          }
                          return false;
                        }).length} jobs
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 4. REAL-TIME HARDWARE & WIN32 SPOOLER LOG */}
      <div className="mt-6 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">
        <div className="flex items-center justify-between mb-2.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-bold text-slate-800">Live Hardware &amp; Win32 Spooler Telemetry Log</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.2 font-mono text-[10px] text-slate-500">
              {hardwareFleet.length + activeJobs.length} Live Records
            </span>
          </div>
          <button
            type="button"
            onClick={async () => {
              try {
                const res = await exportDiagnostics();
                setTestPrintFeedback(
                  res?.bundlePath
                    ? `Diagnostics exported to ${res.bundlePath}.`
                    : "Diagnostics export completed."
                );
              } catch (err) {
                setTestPrintFeedback(err instanceof Error ? err.message : "Diagnostics export failed.");
              } finally {
                setTimeout(() => setTestPrintFeedback(null), 4000);
              }
            }}
            className="font-semibold text-emerald-700 hover:underline cursor-pointer"
          >
            Export Full Hardware Event Log (.evtx / JSON) →
          </button>
        </div>

        <div className="rounded-xl bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
          {hardwareFleet.length === 0 && activeJobs.length === 0 ? (
            <p className="text-slate-500">No live hardware or spooler events are available from the desktop agent.</p>
          ) : (
            <>
              {hardwareFleet.map((printer) => (
                <p key={`printer-${printer.name}`} className="text-emerald-400">
                  {printer.name}: {printer.status} • {printer.isOnline ? "Online" : "Offline"} • Port {printer.portName || "Local"}
                </p>
              ))}
              {activeJobs.map((job) => {
                const title = job.storagePath ? job.storagePath.split("/").pop()?.split("\\").pop() : `Job #${job.printJobId.slice(0, 8)}`;
                return (
                  <p key={`job-${job.printJobId}`} className="text-sky-300">
                    Job {job.printJobId.slice(0, 8)}: {title} • Status: {job.status} • Spooler Job ID: {job.spoolerJobId ?? "Pending"}
                  </p>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}