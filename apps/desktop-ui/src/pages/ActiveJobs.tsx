import { useEffect, useState } from "react";
import type { PrintJobRecord } from "@shared/index";
import { getQueue } from "../lib/ipc";
import StatusBadge from "../components/StatusBadge";

const POLL_INTERVAL_MS = 3000;

export default function ActiveJobs() {
  const [jobs, setJobs] = useState<PrintJobRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const result = await getQueue();
        if (!cancelled) setJobs(result);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold text-brand-900">Active print jobs</h1>
      <p className="mb-6 text-sm text-brand-500">Jobs currently in the local queue on this computer.</p>

      <div className="card divide-y divide-brand-100">
        {jobs.length === 0 && !loading && <p className="py-4 text-sm text-brand-500">No jobs in progress right now.</p>}
        {jobs.map((job) => (
          <div key={job.printJobId} className="flex items-center justify-between py-3">
            <div>
              <p className="font-mono text-xs text-brand-400">{job.printJobId}</p>
              <p className="text-sm text-brand-800">{job.printerName ?? job.printerId}</p>
              {job.lastError && <p className="text-xs text-red-600">{job.lastError}</p>}
            </div>
            <StatusBadge status={job.status} />
          </div>
        ))}
      </div>
    </div>
  );
}
