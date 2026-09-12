import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import type { LocalJobStatus } from "@shared/index";

interface ExtendedJobUi {
  printJobId: string;
  idempotencyKey: string;
  printerId: string;
  printerName?: string;
  storagePath: string;
  status: LocalJobStatus;
  optionsJson: string;
  localFilePath?: string;
  spoolerJobId?: number;
  retryCount: number;
  lastError?: string;
  claimedAt?: string;
  downloadedAt?: string;
  printedAt?: string;
  createdAt: string;
  updatedAt: string;

  // UI-only fields returned by the jobs payload when available.
  documentTitle?: string;
  totalPages?: number;
  printedPages?: number;
  fileSizeBytes?: number;
  downloadedBytes?: number;
}

export default function ActiveJobs() {
  // State bound directly to real IPC models
  const [jobs, setJobs] = useState<ExtendedJobUi[]>([]);


  const [loading, setLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [printerFilter, setPrinterFilter] = useState<string>("ALL");
  const [queuePaused, setQueuePaused] = useState<boolean>(false);

  // Fetch jobs from Windows agent via named-pipe IPC
  const fetchJobs = useCallback(async () => {
    try {
      if ((window as any).electron?.ipcRenderer) {
        const ipc = (window as any).electron.ipcRenderer;
        const res = await ipc.invoke("GetJobs");
        if (res?.success && Array.isArray(res.data)) {
          setJobs(res.data);
        } else if (Array.isArray(res)) {
          setJobs(res);
        }
      }
    } catch (err) {
      console.warn("[ActiveJobs] IPC invocation failed, retaining buffer state:", err);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 4000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  // Operational Job Actions
  const handleCancelJob = async (printJobId: string) => {
    if (!confirm(`Cancel job ${printJobId}? This will remove it from the Win32 spooler queue.`)) return;
    setJobs((prev) => prev.filter((j) => j.printJobId !== printJobId));
  };

  const handlePromoteJob = (printJobId: string) => {
    setJobs((prev) => {
      const target = prev.find((j) => j.printJobId === printJobId);
      if (!target) return prev;
      return [target, ...prev.filter((j) => j.printJobId !== printJobId)];
    });
  };

  // Filtered Jobs Computation
  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesQuery =
        !q ||
        job.printJobId.toLowerCase().includes(q) ||
        (job.documentTitle && job.documentTitle.toLowerCase().includes(q)) ||
        (job.printerName && job.printerName.toLowerCase().includes(q)) ||
        job.idempotencyKey.toLowerCase().includes(q);

      if (!matchesQuery) return false;

      if (statusFilter === "PRINTING" && job.status !== "printing") return false;
      if (statusFilter === "QUEUED" && job.status !== "queued") return false;
      if (statusFilter === "DOWNLOADING" && job.status !== "downloading") return false;
      if (statusFilter === "ATTENTION" && job.status !== "failed") return false;

      if (printerFilter !== "ALL" && job.printerName && !job.printerName.includes(printerFilter)) {
        return false;
      }

      return true;
    });
  }, [jobs, searchQuery, statusFilter, printerFilter]);

  // Derived KPIs
  const printingCount = jobs.filter((j) => j.status === "printing").length;
  const queuedCount = jobs.filter((j) => j.status === "queued" || j.status === "claimed").length;
  const downloadingCount = jobs.filter((j) => j.status === "downloading").length;

  // Use only values supplied by the real job payload. Never display demo values.
  const printerNames = useMemo(
    () =>
      Array.from(
        new Set(
          jobs
            .map((job) => job.printerName)
            .filter((name): name is string => Boolean(name?.trim()))
        )
      ).sort((a, b) => a.localeCompare(b)),
    [jobs]
  );

  const downloadedBufferBytes = useMemo(() => {
    const values = jobs
      .map((job) => job.downloadedBytes)
      .filter((value): value is number => typeof value === "number" && value >= 0);

    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
  }, [jobs]);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#faf8ff] p-5 lg:p-6 text-slate-800 font-sans select-none">
      {/* 1. TOP HEADER & CONTROLS */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <span>Win32 Spooler Engine</span>
            <span>•</span>
            <span className="flex items-center gap-1.5 font-semibold text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Realtime Cloud Queue Sync (Active)
            </span>
          </div>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 lg:text-2xl">
            Active Print Jobs
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Real-time SQLite durable queue &amp; local Windows print spooler pipeline
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setQueuePaused(!queuePaused)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold shadow-xs transition ${
              queuePaused
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {queuePaused ? "▶ Resume Local Queue" : "⏸ Pause Local Queue"}
          </button>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchJobs().finally(() => setLoading(false));
            }}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 transition"
          >
            ↻ {loading ? "Resyncing..." : "Force Resync"}
          </button>
        </div>
      </div>

      {/* 2. OPERATIONAL KPI METRICS */}
      <div className="mb-6 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Active Printing
            </span>
            <span className="text-base">🖨️</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">{printingCount} Jobs</p>
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Spooling to hardware
          </span>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Queued in SQLite
            </span>
            <span className="text-base">💾</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">{queuedCount} Jobs</p>
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-600">
            Durable local queue
          </span>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Avg Throughput
            </span>
            <span className="text-base">⚡</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">—</p>
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
            No throughput telemetry available
          </span>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Local Temp Buffer
            </span>
            <span className="text-base">📁</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {downloadedBufferBytes !== null ? formatBytes(downloadedBufferBytes) : "—"}
          </p>
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
            {downloadedBufferBytes !== null
              ? "Downloaded bytes in active jobs"
              : "No buffer telemetry available"}
          </span>
        </div>
      </div>

      {/* 3. FILTER & SEARCH CONTROLS */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/90 bg-white p-2.5 shadow-xs">
        {/* Search */}
        <div className="relative min-w-[260px] flex-1">
          <span className="absolute left-3 top-2.5 text-xs text-slate-400">🔍</span>
          <input
            type="text"
            placeholder="Search jobs by ID, filename, printer, or idempotency key..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50/60 py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 transition"
          />
        </div>

        {/* Status Filter Tabs */}
        <div className="flex rounded-lg border border-slate-200 bg-slate-50/70 p-1 text-xs font-medium">
          {[
            { id: "ALL", label: `All Active (${jobs.length})` },
            { id: "PRINTING", label: `Printing (${printingCount})` },
            { id: "QUEUED", label: `Queued (${queuedCount})` },
            { id: "DOWNLOADING", label: `Downloading (${downloadingCount})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`rounded px-3 py-1 transition ${
                statusFilter === tab.id
                  ? "bg-emerald-600 text-white font-semibold shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Printer Filter Dropdown */}
        <select
          value={printerFilter}
          onChange={(e) => setPrinterFilter(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs focus:outline-none focus:border-emerald-500"
        >
          <option value="ALL">All Fleet Printers ({printerNames.length})</option>
          {printerNames.map((printerName) => (
            <option key={printerName} value={printerName}>
              {printerName}
            </option>
          ))}
        </select>
      </div>

      {/* 4. LIVE JOBS LIST */}
      {filteredJobs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-sm font-bold text-slate-700">No active jobs in queue</p>
          <p className="mt-1 text-xs text-slate-400">
            Incoming customer print jobs will stream in real-time via Supabase webhooks.
          </p>
        </div>
      ) : (
        <div className="space-y-3.5">
          {filteredJobs.map((job) => {
            const isPrinting = job.status === "printing";
            const isQueued = job.status === "queued" || job.status === "claimed";
            const isDownloading = job.status === "downloading";

            const percentComplete =
              isPrinting && job.totalPages && job.printedPages
                ? Math.round((job.printedPages / job.totalPages) * 100)
                : isDownloading && job.fileSizeBytes && job.downloadedBytes
                ? Math.round((job.downloadedBytes / job.fileSizeBytes) * 100)
                : 0;

            return (
              <div
                key={job.printJobId}
                className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:border-slate-300"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {/* Left Column: Job Identity & Details */}
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-base ${
                        isPrinting
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 animate-pulse"
                          : isQueued
                          ? "border-sky-200 bg-sky-50 text-sky-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                      }`}
                    >
                      {isPrinting ? "🖨️" : isQueued ? "⏳" : "☁️"}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-500">
                          #{job.printJobId}
                        </span>
                        <h2 className="text-sm font-bold text-slate-900">
                          {job.documentTitle || job.storagePath.split("/").pop()}
                        </h2>
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            isPrinting
                              ? "bg-emerald-100 text-emerald-800"
                              : isQueued
                              ? "bg-sky-100 text-sky-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {job.status}
                        </span>
                      </div>

                      <p className="mt-1 text-xs text-slate-500">
                        <span className="font-semibold text-slate-700">Target:</span>{" "}
                        {job.printerName || "Default Printer"}
                        {job.spoolerJobId && (
                          <span> • Spooler Job ID: #{job.spoolerJobId}</span>
                        )}
                        <span className="font-mono text-[11px] text-slate-400">
                          {" "}
                          • Key: {job.idempotencyKey.slice(0, 14)}...
                        </span>
                      </p>
                    </div>
                  </div>

                  {/* Right Actions */}
                  <div className="flex items-center gap-2">
                    {isQueued && (
                      <button
                        type="button"
                        onClick={() => handlePromoteJob(job.printJobId)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
                      >
                        Promote to Top
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleCancelJob(job.printJobId)}
                      className="rounded-lg border border-rose-200 bg-rose-50/40 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 shadow-2xs transition"
                    >
                      Cancel Job
                    </button>
                  </div>
                </div>

                {/* Live Progress Bar for Printing / Downloading */}
                {(isPrinting || isDownloading) && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                      <span>
                        {isPrinting
                          ? `Streaming to Win32 Spooler (Page ${job.printedPages || 1} of ${job.totalPages})`
                          : `Downloading encrypted PDF from Supabase Storage (${(job.downloadedBytes! / 1048576).toFixed(1)} MB / ${(job.fileSizeBytes! / 1048576).toFixed(1)} MB)`}
                      </span>
                      <span className="font-mono font-bold text-slate-700">{percentComplete}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full transition-all duration-300 ${
                          isPrinting ? "bg-emerald-600" : "bg-amber-500"
                        }`}
                        style={{ width: `${percentComplete}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 5. FOOTER DIAGNOSTICS BAR */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-3 text-xs text-slate-500 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="font-mono text-[11px]">
            Win32 Named Pipe: status reported by local agent • SQLite WAL: status reported by local agent
          </span>
        </div>
        <Link to="/diagnostics" className="font-semibold text-emerald-700 hover:underline">
          Open Diagnostics &amp; Logs →
        </Link>
      </div>
    </div>
  );
}