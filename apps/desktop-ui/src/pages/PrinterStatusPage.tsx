import { useEffect, useState } from "react";
import type { PrinterInfo } from "@shared/index";
import { getPrinters, printTestPage } from "../lib/ipc";
import StatusBadge from "../components/StatusBadge";

export default function PrinterStatusPage() {
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingName, setTestingName] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setPrinters(await getPrinters());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, []);

  async function runTestPage(printerName: string) {
    setTestingName(printerName);
    setTestResult(null);
    try {
      await printTestPage({ printerName });
      setTestResult(`Test page sent to ${printerName}.`);
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : "Test page failed.");
    } finally {
      setTestingName(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold text-brand-900">Printer status</h1>
      <p className="mb-6 text-sm text-brand-500">Live status straight from the Windows print spooler.</p>

      {testResult && <p className="mb-4 text-sm text-brand-700">{testResult}</p>}

      <div className="card divide-y divide-brand-100">
  {printers.map((printer, index) => (
    <div
      key={
        printer.fingerprint ||
        printer.name ||
        printer.portName ||
        `printer-${index}`
      }
      className="flex items-center justify-between py-3"
    >
      <div>
        <p className="font-medium text-brand-900">
          {printer.name || "Unknown printer"}
        </p>
        <p className="text-xs text-brand-500">
          {printer.portName || "Unknown port"}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <StatusBadge status={printer.availability || "Unknown"} />

        <button
          className="btn-secondary"
          disabled={testingName === printer.name}
          onClick={() => runTestPage(printer.name)}
        >
          {testingName === printer.name ? "Printing..." : "Print test page"}
        </button>
      </div>
    </div>
  ))}

  {!loading && printers.length === 0 && (
    <p className="py-4 text-sm text-brand-500">
      No printers detected.
    </p>
  )}
</div>
    </div>
  );
}
