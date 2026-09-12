import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { PrintJobRecord } from "@shared/index";
import { getJobs, exportDiagnostics } from "../lib/ipc";

interface HistoricalJobUi {
  printJobId: string;
  idempotencyKey: string;
  printerId: string;
  printerName?: string;
  storagePath: string;
  status: PrintJobRecord["status"];
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

  // Optional values may be supplied by the archive/agent payload.
  documentTitle?: string;
  totalPages?: number;
  printedPages?: number;
  downloadedBytes?: number;
  fileSizeBytes?: number;
  driverName?: string;
  portName?: string;
}

export default function JobHistory() {
  const navigate = useNavigate();

  // 1. STATE BOUND DIRECTLY TO SHARED PRINT JOB CONTRACTS
  // Historical jobs come only from the local agent. No demo records.
  const [historyJobs, setHistoryJobs] = useState<HistoricalJobUi[]>([]);

  // Load archived jobs from the local Windows agent.
  const fetchHistory = useCallback(async () => {
    try {
      const data = await getJobs();
      if (Array.isArray(data)) {
        setHistoryJobs(data as HistoricalJobUi[]);
      } else {
        setHistoryJobs([]);
      }
    } catch (err) {
      console.warn("[JobHistory] Failed to load archived jobs:", err);
      setHistoryJobs([]);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Filtering & Pagination State
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [printerFilter, setPrinterFilter] = useState<string>("ALL");
  const [dateRange, setDateRange] = useState<string>("30d");
  const [exporting, setExporting] = useState<boolean>(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // 2. EXPORT DIAGNOSTICS & AUDIT BUNDLE VIA REAL IPC
  const handleExportAuditBundle = async () => {
    setExporting(true);
    setExportNotice(null);

    try {
      const res = await exportDiagnostics();
      if (res?.bundlePath) {
        setExportNotice(`Audit bundle exported to ${res.bundlePath}`);
      } else {
        setExportNotice("Audit bundle export completed.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to export audit bundle.";
      setExportNotice(message);
    } finally {
      setExporting(false);
      setTimeout(() => setExportNotice(null), 5000);
    }
  };

  // Parse optional print options from the canonical JSON payload.
  const getJobOptions = (job: PrintJobRecord) => {
    try {
      const parsed = JSON.parse(job.optionsJson || "{}");
      return {
        duplex: typeof parsed.duplex === "boolean" ? parsed.duplex : undefined,
        color: typeof parsed.color === "boolean" ? parsed.color : undefined,
        mediaSize:
          typeof parsed.paper === "string"
            ? parsed.paper
            : typeof parsed.mediaSize === "string"
            ? parsed.mediaSize
            : undefined,
      };
    } catch {
      return { duplex: undefined, color: undefined, mediaSize: undefined };
    }
  };

  const getDocumentTitle = (job: HistoricalJobUi) =>
    job.documentTitle || job.storagePath.split("/").pop() || job.printJobId;

  const getCompletedDate = (job: HistoricalJobUi) =>
    job.printedAt || job.updatedAt || job.createdAt;

  const getDurationSeconds = (job: HistoricalJobUi) => {
    if (job.claimedAt && job.printedAt) {
      const duration = Math.round(
        (new Date(job.printedAt).getTime() - new Date(job.claimedAt).getTime()) / 1000
      );
      return Number.isFinite(duration) && duration >= 0 ? duration : null;
    }
    return null;
  };

  const formatDateTime = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  };

  const printerNames = useMemo(
    () =>
      Array.from(
        new Set(
          historyJobs
            .map((job) => job.printerName)
            .filter((name): name is string => Boolean(name?.trim()))
        )
      ).sort((a, b) => a.localeCompare(b)),
    [historyJobs]
  );

  const completedJobsCount = historyJobs.filter((job) => job.status === "completed").length;
  const failedJobsCount = historyJobs.filter(
    (job) => job.status === "failed" || job.status === "cancelled"
  ).length;
  const totalPagesPrinted = historyJobs.reduce(
    (sum, job) => sum + (typeof job.totalPages === "number" ? job.totalPages : 0),
    0
  );
  const colorPages = historyJobs.reduce((sum, job) => {
    const options = getJobOptions(job);
    return sum + (options.color ? job.totalPages || 0 : 0);
  }, 0);
  const monoPages = Math.max(0, totalPagesPrinted - colorPages);
  const retryCount = historyJobs.reduce((sum, job) => sum + (job.retryCount || 0), 0);
  const successRate =
    historyJobs.length > 0
      ? ((completedJobsCount / historyJobs.length) * 100).toFixed(1)
      : null;

  const filteredJobs = useMemo(() => {
    const now = Date.now();
    const rangeDays =
      dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : dateRange === "90d" ? 90 : null;
    const cutoff = rangeDays === null ? null : now - rangeDays * 24 * 60 * 60 * 1000;

    return historyJobs.filter((job) => {
      const q = searchQuery.toLowerCase().trim();
      const documentTitle = getDocumentTitle(job);
      const matchesSearch =
        !q ||
        job.printJobId.toLowerCase().includes(q) ||
        documentTitle.toLowerCase().includes(q) ||
        Boolean(job.printerName?.toLowerCase().includes(q)) ||
        job.idempotencyKey.toLowerCase().includes(q);

      if (!matchesSearch) return false;

      if (statusFilter === "COMPLETED" && job.status !== "completed") return false;
      if (
        statusFilter === "FAILED" &&
        job.status !== "failed" &&
        job.status !== "cancelled"
      ) return false;

      if (printerFilter !== "ALL" && job.printerName !== printerFilter) return false;

      if (cutoff !== null) {
        const timestamp = new Date(getCompletedDate(job)).getTime();
        if (Number.isNaN(timestamp) || timestamp < cutoff) return false;
      }

      return true;
    });
  }, [historyJobs, searchQuery, statusFilter, printerFilter, dateRange]);

  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(filteredJobs.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedJobs = filteredJobs.slice(
    (safeCurrentPage - 1) * pageSize,
    safeCurrentPage * pageSize
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, printerFilter, dateRange]);

  const pageStart = filteredJobs.length === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(safeCurrentPage * pageSize, filteredJobs.length);


  return (
    <div className="flex-1 overflow-y-auto bg-[#faf8ff] p-5 lg:p-6 font-sans text-slate-800 select-none">
      {/* 1. AGENT ARCHIVE STATUS BANNER */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200/80 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-900 shadow-2xs">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-200 text-[11px] font-bold text-amber-900">
            i
          </span>
          <span className="font-semibold">SQLite Archive WAL Synchronized:</span>
          <span>
            {historyJobs.length > 0
              ? <>Historical telemetry loaded from the local agent. <strong>{historyJobs.length.toLocaleString()}</strong> archived jobs available.</>
              : <>No historical telemetry is currently available from the local agent.</>}
          </span>
        </div>
        <button
          type="button"
          onClick={() => navigate("/diagnostics")}
          className="font-semibold text-amber-900 underline hover:text-amber-950"
        >
          Database Maintenance →
        </button>
      </div>

      {/* 2. OPERATIONAL HEADER */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <span>Win32 Spooler Engine</span>
            <span>•</span>
            <span className="font-mono text-[11px] text-slate-600">
              Completed &amp; Audited Jobs Archive (SQLite WAL Database)
            </span>
          </div>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 lg:text-2xl">
            Job History &amp; Audit Log
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Historical record of completed, canceled, and failed print jobs with cryptographic receipts and driver telemetry.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs focus:border-emerald-500 focus:outline-none"
          >
            <option value="7d">Date Range: Last 7 Days</option>
            <option value="30d">Date Range: Last 30 Days</option>
            <option value="90d">Date Range: Last 90 Days</option>
            <option value="all">All Time</option>
          </select>

          <button
            type="button"
            onClick={handleExportAuditBundle}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50 transition cursor-pointer"
          >
            📥 {exporting ? "Exporting..." : "Export CSV / Audit Bundle"}
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-emerald-600 p-2 text-xs text-white shadow-2xs hover:bg-emerald-700 transition"
            title="Refresh database view"
          >
            ↻
          </button>
        </div>
      </div>

      {exportNotice && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          {exportNotice}
        </div>
      )}

      {/* 3. HISTORICAL AUDIT KPIS */}
      <div className="mb-6 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Total Completed Jobs
            </span>
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-50 text-xs font-bold text-emerald-600">
              ✓
            </span>
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">{completedJobsCount.toLocaleString()}</p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
              Completed
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Total Pages Printed
            </span>
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-sky-50 text-xs font-bold text-sky-600">
              📄
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-slate-900">
              {totalPagesPrinted.toLocaleString()}
            </span>
            <span className="text-xs text-slate-400">pages</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-500">
            <span>● Color: {colorPages}</span>
            <span>● Mono: {monoPages}</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Success Spool Rate
            </span>
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-50 text-xs font-bold text-emerald-600">
              🛡️
            </span>
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">{successRate !== null ? `${successRate}%` : "—"}</p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
              {retryCount.toLocaleString()} retries recorded
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Paper / Media Waste
            </span>
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-50 text-xs font-bold text-amber-600">
              ♻️
            </span>
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">—</p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="text-[11px] text-slate-400">No waste telemetry available</span>
          </div>
        </div>
      </div>

      {/* 4. FILTER / SEARCH CONTROLS */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/90 bg-white p-2.5 shadow-xs">
        {/* Search */}
        <div className="relative min-w-[260px] flex-1">
          <span className="absolute left-3 top-2.5 text-xs text-slate-400">🔍</span>
          <input
            type="text"
            placeholder="Search history by Job ID, filename, customer hash, or printer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50/60 py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 transition"
          />
        </div>

        {/* Printer Selector */}
        <select
          value={printerFilter}
          onChange={(e) => setPrinterFilter(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-2xs focus:border-emerald-500 focus:outline-none"
        >
          <option value="ALL">🖨️ Printers: All Fleet</option>
          {printerNames.map((printerName) => (
            <option key={printerName} value={printerName}>
              {printerName}
            </option>
          ))}
        </select>

        {/* Status Filter Tabs */}
        <div className="flex rounded-lg border border-slate-200 bg-slate-50/70 p-1 text-xs font-medium">
          {[
            { id: "ALL", label: `All (${historyJobs.length.toLocaleString()})` },
            { id: "COMPLETED", label: `Completed (${completedJobsCount.toLocaleString()})` },
            { id: "FAILED", label: `Failed / Canceled (${failedJobsCount.toLocaleString()})` },
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
      </div>

      {/* 5. AUDITED JOBS TABLE */}
      <div className="rounded-xl border border-slate-200/90 bg-white shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200/80 bg-slate-50/75 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4">Print Job &amp; Spool Token</th>
                <th className="py-3 px-4">Assigned Hardware &amp; Port</th>
                <th className="py-3 px-4">Configuration / Media</th>
                <th className="py-3 px-4">Timestamp &amp; Latency</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Receipt / Audit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedJobs.map((job) => {
                const isCompleted = job.status === "completed";
                const isFailed = job.status === "failed" || job.status === "cancelled";
                const options = getJobOptions(job);
                const durationSeconds = getDurationSeconds(job);

                return (
                  <tr
                    key={job.printJobId}
                    className="hover:bg-slate-50/60 transition-colors"
                  >
                    {/* Column 1: Document & Job Identity */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-bold ${
                            isCompleted
                              ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                              : "border-rose-100 bg-rose-50 text-rose-700"
                          }`}
                        >
                          {isCompleted ? "📄" : "⚠️"}
                        </div>
                        <div>
                          <p className={`font-bold ${isFailed ? "text-rose-900" : "text-slate-900"}`}>
                            {getDocumentTitle(job)}
                          </p>
                          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono mt-0.5">
                            <span>#{job.printJobId}</span>
                            <span>•</span>
                            <span>{job.spoolerJobId ? `Win32 Spool #${job.spoolerJobId}` : job.lastError}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Column 2: Assigned Printer Hardware */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5 font-medium text-slate-800">
                        <span>🖨️</span>
                        <span>{job.printerName}</span>
                        {job.portName && (
                          <span className="rounded bg-slate-100 px-1 py-0.2 text-[9px] font-mono text-slate-500">
                            {job.portName}
                          </span>
                        )}
                      </div>
                      {job.driverName && (
                        <p className="font-mono text-[10px] text-slate-400 mt-0.5">
                          Driver: {job.driverName}
                        </p>
                      )}
                    </td>

                    {/* Column 3: Media Specs */}
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-slate-800">
                        {isFailed
                          ? `${job.totalPages ?? 0} Pages${job.lastError ? " • Error" : ""}`
                          : `${job.totalPages ?? "—"} Pages${options.duplex !== undefined ? ` • ${options.duplex ? "Duplex" : "Simplex"}` : ""}`}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {options.color !== undefined && (
                          options.color ? (
                            <span className="text-emerald-700 font-semibold">Color • </span>
                          ) : (
                            <span>Mono • </span>
                          )
                        )}
                        {options.mediaSize || "Media details unavailable"}
                      </p>
                    </td>

                    {/* Column 4: Timestamp */}
                    <td className="py-3.5 px-4">
                      <div className="text-slate-700">{formatDateTime(getCompletedDate(job))}</div>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                        {durationSeconds !== null ? `Duration: ${durationSeconds}s • ` : ""}
                        {job.retryCount} Retries
                      </p>
                    </td>

                    {/* Column 5: Status Pill */}
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          isCompleted
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-rose-50 text-rose-700 border border-rose-200"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            isCompleted ? "bg-emerald-500" : "bg-rose-500"
                          }`}
                        />
                        {job.status}
                      </span>
                    </td>

                    {/* Column 6: Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {isFailed ? (
                          <button
                            type="button"
                            onClick={() => alert(`Error diagnostic: ${job.lastError}`)}
                            className="rounded-lg border border-slate-200 p-1 text-slate-600 hover:bg-slate-100"
                            title="Error details"
                          >
                            ⚙️
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => alert(`Receipt #${job.printJobId} cryptographic hash: ${job.idempotencyKey}`)}
                            className="rounded-lg border border-slate-200 p-1 text-slate-600 hover:bg-slate-100"
                            title="Cryptographic receipt"
                          >
                            🧾
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => navigate("/diagnostics")}
                          className="rounded-lg border border-slate-200 p-1 text-slate-600 hover:bg-slate-100"
                          title="Audit log"
                        >
                          📋
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500 bg-slate-50/40">
          <span>
            Showing <strong>{pageStart} to {pageEnd}</strong> of <strong>{filteredJobs.length}</strong> archived jobs
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={safeCurrentPage <= 1}
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-300 cursor-not-allowed text-xs font-medium"
            >
              &lt; Previous
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, index) => index + 1).map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => setCurrentPage(page)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                  safeCurrentPage === page
                    ? "bg-emerald-600 text-white font-bold"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {page}
              </button>
            ))}
            <button
              type="button"
              disabled={safeCurrentPage >= totalPages}
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-600 hover:bg-slate-50 text-xs font-medium disabled:opacity-50"
            >
              Next &gt;
            </button>
          </div>
        </div>
      </div>

      {/* 6. STORAGE & ARCHIVE RETENTION AUDIT BAR */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-3 text-xs text-slate-500 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="text-base">🗄️</span>
          <span className="font-mono text-[11px]">
            Local archive storage and retention details are reported by the desktop agent when available.
          </span>
        </div>
        <button
          type="button"
          onClick={handleExportAuditBundle}
          className="font-semibold text-emerald-700 hover:underline"
        >
          Export Raw Diagnostics Bundle →
        </button>
      </div>
    </div>
  );
}