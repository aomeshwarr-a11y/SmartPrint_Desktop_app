import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PrinterInfo } from "@shared/index";
import { getPrinters } from "../lib/ipc";
import StatusBadge from "../components/StatusBadge";

export default function PrinterDiscovery() {
  const navigate = useNavigate();
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const result = await getPrinters();
      setPrinters(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the SmartPrinter background service.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-brand-900">Printer discovery</h1>
          <p className="text-sm text-brand-500">Printers currently installed in Windows on this computer.</p>
        </div>
        <button className="btn-secondary" onClick={refresh} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="card divide-y divide-brand-100">
        {printers.length === 0 && !loading && (
          <p className="py-4 text-sm text-brand-500">
            No printers found. Install your printer's Windows driver first, then click Refresh.
          </p>
        )}
        {printers.map((printer) => (
          <div key={printer.name} className="flex items-center justify-between py-3">
            <div>
              <p className="font-medium text-brand-900">
                {printer.name} {printer.isDefault && <span className="text-xs text-brand-400">(default)</span>}
              </p>
              <p className="text-xs text-brand-500">
                {printer.driverName} · {printer.portName} · {printer.supportsColor ? "Color" : "B/W"} ·{" "}
                {printer.supportsDuplex ? "Duplex" : "Simplex"}
              </p>
            </div>
            <StatusBadge status={printer.availability} />
          </div>
        ))}
      </div>

      <button className="btn-primary mt-6 w-full" onClick={() => navigate("/printers/authorize")}>
        Continue to authorize printers
      </button>
    </div>
  );
}
