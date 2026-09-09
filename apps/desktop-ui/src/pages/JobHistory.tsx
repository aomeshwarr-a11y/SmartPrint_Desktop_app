import { useEffect, useState } from "react";
import type { PrintJobRecord } from "@shared/index";
import { getJobs } from "../lib/ipc";
import StatusBadge from "../components/StatusBadge";

export default function JobHistory() {
  const [jobs, setJobs] = useState<PrintJobRecord[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const result = await getJobs();
      setJobs(result);
      setLoading(false);
    }
    void load();
  }, []);

  const filtered = jobs.filter(
    (job) =>
      job.printJobId.toLowerCase().includes(search.toLowerCase()) ||
      (job.printerName ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-brand-900">Job history</h1>
          <p className="text-sm text-brand-500">The last 200 jobs processed on this computer.</p>
        </div>
        <input
          className="input w-64"
          placeholder="Search by job id or printer..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-brand-50 text-left text-xs uppercase text-brand-500">
            <tr>
              <th className="px-4 py-3">Job</th>
              <th className="px-4 py-3">Printer</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Retries</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-100">
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-brand-500">
                  No jobs found.
                </td>
              </tr>
            )}
            {filtered.map((job) => (
              <tr key={job.printJobId}>
                <td className="px-4 py-3 font-mono text-xs text-brand-500">{job.printJobId.slice(0, 8)}</td>
                <td className="px-4 py-3">{job.printerName ?? job.printerId}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={job.status} />
                </td>
                <td className="px-4 py-3 text-brand-500">{new Date(job.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3 text-brand-500">{job.retryCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
