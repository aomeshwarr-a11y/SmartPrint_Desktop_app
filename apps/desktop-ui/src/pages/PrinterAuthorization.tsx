import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PrinterInfo } from "@shared/index";
import { authorizePrinter, getPrinters } from "../lib/ipc";

interface PrinterWithAuth extends PrinterInfo {
  authorized: boolean;
}

export default function PrinterAuthorization() {
  const navigate = useNavigate();
  const [printers, setPrinters] = useState<PrinterWithAuth[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const result = await getPrinters();
      setPrinters(result.map((p) => ({ ...p, authorized: false })));
      setLoading(false);
    }
    void load();
  }, []);

  async function toggle(printer: PrinterWithAuth) {
    setSavingName(printer.name);
    try {
      await authorizePrinter({ printerName: printer.name, authorized: !printer.authorized });
      setPrinters((prev) =>
        prev.map((p) => (p.name === printer.name ? { ...p, authorized: !p.authorized } : p)),
      );
    } finally {
      setSavingName(null);
    }
  }

  const anyAuthorized = printers.some((p) => p.authorized);

  if (loading) return <p className="text-brand-500">Loading printers...</p>;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold text-brand-900">Authorize printers</h1>
      <p className="mb-6 text-sm text-brand-500">
        Choose which printers customers may send jobs to. You can change this any time.
      </p>

      <div className="card divide-y divide-brand-100">
        {printers.map((printer, index) => (
          <div key={printer.fingerprint || printer.name || printer.portName || `printer-${index}`} className="flex items-center justify-between py-3">
            <div>
              <p className="font-medium text-brand-900">{printer.name || "Unknown printer"}</p>
              <p className="text-xs text-brand-500">{printer.driverName || "Unknown driver"}</p>
            </div>
            <button
              role="switch"
              aria-checked={printer.authorized}
              disabled={savingName === printer.name}
              onClick={() => toggle(printer)}
              className={`relative h-6 w-11 rounded-full transition ${printer.authorized ? "bg-brand-600" : "bg-brand-100"}`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                  printer.authorized ? "left-5" : "left-0.5"
                }`}
              />
            </button>
          </div>
        ))}
      </div>

      <button className="btn-primary mt-6 w-full" disabled={!anyAuthorized} onClick={() => navigate("/qr")}>
        Continue to QR code
      </button>
    </div>
  );
}
