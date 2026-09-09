import { useState } from "react";
import { exportDiagnostics, getLogs } from "../lib/ipc";

export default function Diagnostics() {
  const [lines, setLines] = useState<string[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [bundlePath, setBundlePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadLogs() {
    setLoadingLogs(true);
    setError(null);
    try {
      const result = await getLogs();
      setLines(result.lines);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load logs.");
    } finally {
      setLoadingLogs(false);
    }
  }

  async function exportBundle() {
    setExporting(true);
    setBundlePath(null);
    try {
      const result = await exportDiagnostics();
      setBundlePath(result.bundlePath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export diagnostics.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-xl font-semibold text-brand-900">Diagnostics</h1>
      <p className="mb-6 text-sm text-brand-500">
        Useful when something isn't printing right and you need to send logs to support.
      </p>

      <div className="mb-6 flex gap-3">
        <button className="btn-secondary" onClick={loadLogs} disabled={loadingLogs}>
          {loadingLogs ? "Loading..." : "Load recent logs"}
        </button>
        <button className="btn-primary" onClick={exportBundle} disabled={exporting}>
          {exporting ? "Exporting..." : "Export diagnostic bundle"}
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {bundlePath && (
        <p className="mb-4 text-sm text-brand-700">
          Diagnostic bundle saved to <span className="font-mono">{bundlePath}</span>. Attach this file to a support request.
        </p>
      )}

      <div className="card max-h-96 overflow-y-auto bg-brand-900 p-4 font-mono text-xs text-brand-50">
        {lines.length === 0 ? (
          <p className="text-brand-300">No logs loaded yet.</p>
        ) : (
          lines.map((line, i) => <div key={i}>{line}</div>)
        )}
      </div>
    </div>
  );
}
