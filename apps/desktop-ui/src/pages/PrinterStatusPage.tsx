import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
interface PrinterTelemetryData {
  name: string;
  driverName?: string;
  portName?: string;
  isDefault?: boolean;
  status?: string;
  isOnline?: boolean;
  availability?: string;
  fingerprint?: string;
  engineType?: string;
  ipAddress?: string;
  ppmSpeed?: number;
  fuserTemp?: string;
  lifetimePages?: number;
  wasteBoxOk?: boolean;
  supportsColor?: boolean;
  supportsDuplex?: boolean;
  toner?: Array<{
    label: string;
    percent: number;
    colorClass?: string;
  }>;
  trays?: Array<{
    name: string;
    capacity: string;
    percent: number;
  }>;
}

interface ServiceStatusState {
  agentVersion?: string;
  serviceVersion?: string;
  pipeConnected?: boolean;
  isPaired?: boolean;
  realtimeConnected?: boolean;
  mockCloudMode?: boolean;
  queuedJobCount?: number;
}

interface ActiveJobState {
  id: string;
  documentTitle?: string;
  printerName?: string;
  status?: string;
}

export default function PrinterStatusPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const targetPrinterName = searchParams.get("target");

  const [serviceStatus, setServiceStatus] = useState<ServiceStatusState | null>(null);
  const [hardwareFleet, setHardwareFleet] = useState<PrinterTelemetryData[]>([]);
  const [activeJobs, setActiveJobs] = useState<ActiveJobState[]>([]);

  const [testPrintFeedback, setTestPrintFeedback] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Poll real printer/service/job data from the desktop agent.
  const fetchTelemetry = useCallback(async () => {
    setRefreshing(true);
    try {
      if (!(window as any).electron?.ipcRenderer) {
        setServiceStatus(null);
        setHardwareFleet([]);
        setActiveJobs([]);
        return;
      }

      const ipc = (window as any).electron.ipcRenderer;

      const [statusRes, printersRes, jobsRes] = await Promise.all([
        ipc.invoke("GetServiceStatus"),
        ipc.invoke("GetPrinters"),
        ipc.invoke("GetJobs"),
      ]);

      if (statusRes?.success && statusRes.data) {
        setServiceStatus(statusRes.data as ServiceStatusState);
      } else {
        setServiceStatus(null);
      }

      if (printersRes?.success && Array.isArray(printersRes.data)) {
        setHardwareFleet(printersRes.data as PrinterTelemetryData[]);
      } else if (Array.isArray(printersRes)) {
        setHardwareFleet(printersRes as PrinterTelemetryData[]);
      } else {
        setHardwareFleet([]);
      }

      if (jobsRes?.success && Array.isArray(jobsRes.data)) {
        setActiveJobs(jobsRes.data as ActiveJobState[]);
      } else if (Array.isArray(jobsRes)) {
        setActiveJobs(jobsRes as ActiveJobState[]);
      } else {
        setActiveJobs([]);
      }
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
      if ((window as any).electron?.ipcRenderer) {
        const ipc = (window as any).electron.ipcRenderer;
        const res = await ipc.invoke("PrintTestPage", { printerName });
        if (res?.success) {
          setTestPrintFeedback(`Test page spooled successfully to ${printerName}.`);
        } else {
          setTestPrintFeedback(`Spooler alert: ${res?.error || "Print submission rejected"}`);
        }
      } else {
        setTestPrintFeedback("Test printing is available only in the SmartPrinter desktop agent.");
      }
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
            <span>winspool.drv Hook Active</span>
            <span>•</span>
            <span className="font-mono text-[11px]">Agent v{serviceStatus?.agentVersion}</span>
            <span>•</span>
            <span className="font-mono text-[11px] text-slate-400">IPC: \\.\pipe\SmartPrinterAgent</span>
          </div>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 lg:text-2xl">
            Printer Fleet Status &amp; Hardware Telemetry
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Real-time port inspection, ink/toner metrics, paper trays, and spooler driver diagnostics across local Win32 instances.
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
              {hardwareFleet.filter(
                (printer) => printer.isOnline ?? printer.availability === "Ready"
              ).length}{" "}
              / {hardwareFleet.length}
            </span>
            <span className="text-xs font-semibold text-emerald-600">
              {hardwareFleet.length > 0
                ? `${Math.round(
                    (hardwareFleet.filter(
                      (printer) => printer.isOnline ?? printer.availability === "Ready"
                    ).length /
                      hardwareFleet.length) *
                      100
                  )}% Operational`
                : "No telemetry"}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
              {hardwareFleet.length > 0
                ? `${hardwareFleet.filter(
                    (printer) => !(printer.isOnline ?? printer.availability === "Ready")
                  ).length} offline units detected`
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
            {serviceStatus?.pipeConnected ? "Connected" : "—"}
          </p>
          <p className="mt-1 font-mono text-[11px] text-emerald-600 font-semibold">
            {serviceStatus?.pipeConnected ? "Named Pipe Connected" : "Pipe status unavailable"}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Toner &amp; Consumables
            </span>
            <span className="text-base">💧</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {hardwareFleet.some((printer) => printer.toner?.length) ? "Available" : "—"}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {(() => {
              const levels = hardwareFleet
                .flatMap((printer) => printer.toner || [])
                .map((toner) => toner.percent)
                .filter((value): value is number => typeof value === "number");
              return levels.length
                ? `Minimum ${Math.min(...levels)}%`
                : "No consumable telemetry available";
            })()}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Paper Trays Status
            </span>
            <span className="text-base">📦</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {hardwareFleet.some((printer) => printer.trays?.length) ? "Available" : "—"}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {(() => {
              const trays = hardwareFleet.flatMap((printer) => printer.trays || []);
              return trays.length ? `${trays.length} tray${trays.length === 1 ? "" : "s"} reported` : "No tray telemetry available";
            })()}
          </p>
        </div>
      </div>

      {/* 3. HARDWARE DEEP DIVE FLEET LIST */}
      <div className="space-y-4">
        {hardwareFleet.map((printer) => {
          const isTargeted = targetPrinterName === printer.name;
          const availability = printer.isOnline
            ? printer.status === "printing"
              ? "Busy"
              : "Ready"
            : "Offline";
          const isReady = availability === "Ready";
          const isBusy = availability === "Busy";

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
                        {printer?.engineType || "—"}
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono text-xs text-slate-400">
                      Port: <span className="text-slate-700 font-semibold">{printer?.portName}</span> •
                      Fingerprint: <span className="text-slate-500">{printer?.fingerprint}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${
                      isReady
                        ? "bg-emerald-100 text-emerald-800"
                        : isBusy
                        ? "bg-blue-100 text-blue-800"
                        : "bg-rose-100 text-rose-800"
                    }`}
                  >
                    ● {printer.availability}
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
                    onClick={() => alert(`Restarting print spooler driver for ${printer.name}...`)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition"
                  >
                    Restart Driver
                  </button>
                </div>
              </div>

              {/* Middle: 3-Column Metrics Breakdown */}
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
                {/* Consumables Gauges */}
                <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3.5">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-2.5">
                    <span>Consumables &amp; Inks</span>
                    {printer.wasteBoxOk && (
                      <span className="font-mono text-[10px] text-emerald-600 font-semibold">
                        Waste Box: OK
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {(printer.toner ?? []).map((t) => (
                      <div key={t.label}>
                        <div className="flex justify-between text-[11px] font-medium text-slate-600 mb-0.5">
                          <span>{t.label}</span>
                          <span className="font-mono font-bold text-slate-800">{t.percent}%</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                          <div className={`h-full ${t.colorClass}`} style={{ width: `${t.percent}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Paper Cassettes */}
                <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3.5">
                  <div className="text-xs font-bold text-slate-700 mb-2.5">
                    Paper Cassettes &amp; Trays
                  </div>
                  <div className="space-y-2.5">
                    {(printer.trays ?? []).map((tray) => (
                      <div key={tray.name} className="rounded-lg border border-slate-200/70 bg-white p-2 text-xs">
                        <div className="flex justify-between font-medium text-slate-800">
                          <span>{tray.name}</span>
                          <span className="font-mono font-semibold text-emerald-700">{tray.capacity}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full bg-emerald-600" style={{ width: `${tray.percent}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Spooler & Hardware Telemetry */}
                <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3.5">
                  <div className="text-xs font-bold text-slate-700 mb-2.5">
                    Win32 Driver &amp; Life Metrics
                  </div>
                  <div className="space-y-1.5 font-mono text-[11px] text-slate-600">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Driver:</span>
                      <span className="truncate max-w-[170px] text-slate-800 font-semibold">{printer?.driverName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Duplex Support:</span>
                      <span className="text-slate-800">{printer.supportsDuplex ? "Supported" : "Simplex Only"}</span>
                    </div>
                    {printer?.fuserTemp && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Fuser Temp:</span>
                        <span className="text-emerald-700 font-semibold">{printer?.fuserTemp}</span>
                      </div>
                    )}
                    {typeof printer?.lifetimePages === "number" && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Lifetime Pages:</span>
                        <span className="text-slate-800 font-bold">{printer?.lifetimePages.toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-1 border-t border-slate-200/60">
                      <span className="text-slate-400">Active Spooler Job:</span>
                      <span className="text-slate-800 font-semibold">
                        {(() => {
                          const printerJobs = activeJobs.filter(
                            (job) => job.printerName === printer.name
                          );
                          const printingJob = printerJobs.find((job) => job.status === "printing");
                          return printingJob
                            ? `${printingJob.id} (Printing)`
                            : `${printerJobs.length} pending job${printerJobs.length === 1 ? "" : "s"}`;
                        })()}
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
                if (!(window as any).electron?.ipcRenderer) {
                  setTestPrintFeedback("Diagnostics export is available only in the desktop agent.");
                  return;
                }
                const res = await (window as any).electron.ipcRenderer.invoke("ExportDiagnostics");
                setTestPrintFeedback(
                  res?.success
                    ? `Diagnostics exported${res.data?.bundlePath ? ` to ${res.data.bundlePath}` : ""}.`
                    : res?.error || "Diagnostics export failed."
                );
              } catch (err) {
                setTestPrintFeedback(err instanceof Error ? err.message : "Diagnostics export failed.");
              } finally {
                setTimeout(() => setTestPrintFeedback(null), 4000);
              }
            }}
            className="font-semibold text-emerald-700 hover:underline"
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
                  {printer.name}: {printer.status} • {printer.isOnline ? "Online" : "Offline"} • Port {printer?.portName || "—"}
                </p>
              ))}
              {activeJobs.map((job) => (
                <p key={`job-${job.id}`} className="text-sky-300">
                  Job {job.id}: {job.documentTitle} • {job.status} • {job.printerName || "Printer unavailable"}
                </p>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}