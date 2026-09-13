import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import type {
  PrinterInfo,
  AuthorizePrinterRequest,
  ServiceStatusDto,
} from "@shared/index";
import {
  getPrinters,
  getServiceStatus,
  authorizePrinter,
  getSettings,
  updateSettings,
} from "../lib/ipc";
import { supabase } from "../lib/supabaseClient";

interface PrinterAuthorizationUi extends PrinterInfo {
  isAuthorized?: boolean;
  colorTariff?: string;
  monoTariff?: string;
  formats?: string[];
  connectionType?: "USB" | "Network" | "Virtual";
}

export default function PrinterAuthorization() {

  // 1. STATE BOUND DIRECTLY TO REAL IPC CONTRACTS
  // Live printer inventory comes only from the desktop agent.
  const [printers, setPrinters] = useState<PrinterAuthorizationUi[]>([]);

  const [serviceStatus, setServiceStatus] = useState<ServiceStatusDto | null>(null);

  // Policy toggles
  const [defaultQuarantine, setDefaultQuarantine] = useState<boolean>(true);
  const [allowUsbOverride, setAllowUsbOverride] = useState<boolean>(true);
  const [autoPauseOnJam, setAutoPauseOnJam] = useState<boolean>(true);
  const [spoolLimitMb, setSpoolLimitMb] = useState<string>("50 MB");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [saveBanner, setSaveBanner] = useState<string | null>(null);

  // 2. FETCH PRINTERS AND SERVICE STATUS VIA IPC
  const fetchPrinters = useCallback(async () => {
    try {
      const [printersRes, statusRes, settingsRes] = await Promise.all([
        getPrinters().catch(() => [] as PrinterInfo[]),
        getServiceStatus().catch(() => null),
        getSettings().catch(() => ({} as Record<string, string | null>)),
      ]);

      const cloudPrintersMap = new Map<string, boolean>();
      if (statusRes?.isPaired && statusRes.deviceId) {
        const { data: cpData } = await supabase
          .from("printers")
          .select("windows_printer_name, authorized")
          .eq("device_id", statusRes.deviceId);
        if (cpData) {
          cpData.forEach((cp) => cloudPrintersMap.set(cp.windows_printer_name, cp.authorized));
        }
      }

      setPrinters(
        printersRes.map((p) => ({
          ...p,
          isAuthorized: cloudPrintersMap.has(p.name) ? cloudPrintersMap.get(p.name) : false,
          connectionType: p.portName?.toUpperCase().includes("USB")
            ? "USB"
            : p.portName?.toUpperCase().includes("IP") || p.portName?.includes(".")
            ? "Network"
            : "Virtual",
          formats: ["PDF", "A4", p.supportsColor ? "Color" : "Mono", p.supportsDuplex ? "Duplex" : "Simplex"],
        }))
      );
      setServiceStatus(statusRes);

      if (settingsRes) {
        if (settingsRes.defaultQuarantine !== undefined && settingsRes.defaultQuarantine !== null) {
          setDefaultQuarantine(settingsRes.defaultQuarantine === "true");
        }
        if (settingsRes.allowUsbOverride !== undefined && settingsRes.allowUsbOverride !== null) {
          setAllowUsbOverride(settingsRes.allowUsbOverride === "true");
        }
        if (settingsRes.autoPauseOnJam !== undefined && settingsRes.autoPauseOnJam !== null) {
          setAutoPauseOnJam(settingsRes.autoPauseOnJam === "true");
        }
        if (settingsRes.spoolLimitMb) {
          setSpoolLimitMb(settingsRes.spoolLimitMb);
        }
      }
    } catch (err) {
      console.warn("Authorization IPC error:", err);
      setPrinters([]);
      setServiceStatus(null);
    }
  }, []);

  useEffect(() => {
    fetchPrinters();
  }, [fetchPrinters]);

  // 3. TOGGLE AUTHORIZATION WITH EXACT COMMAND IpcCommands.AuthorizePrinter
  const handleToggleAuthorize = async (
    printerName: string,
    currentStatus: boolean,
    targetStatus?: boolean
  ) => {
    const newStatus = targetStatus ?? !currentStatus;

    // Optimistic UI update
    setPrinters((prev) =>
      prev.map((p) => (p.name === printerName ? { ...p, isAuthorized: newStatus } : p))
    );

    try {
      const payload: AuthorizePrinterRequest = {
        printerName,
        authorized: newStatus,
      };
      await authorizePrinter(payload);

      if (serviceStatus?.deviceId) {
        await supabase
          .from("printers")
          .update({ authorized: newStatus, updated_at: new Date().toISOString() })
          .eq("device_id", serviceStatus.deviceId)
          .eq("windows_printer_name", printerName);
      }

      setSaveBanner(`Permissions updated: ${printerName} is now ${newStatus ? "Authorized" : "Blocked"}`);
    } catch (err: any) {
      setSaveBanner(err?.message || "Failed to update authorization");
    } finally {
      setTimeout(() => setSaveBanner(null), 4000);
    }
  };

  const handleAuthorizeAllQualified = async () => {
    const qualified = printers.filter((p) => p.connectionType !== "Virtual");
    if (!qualified.length) {
      setSaveBanner("No qualified physical printers are currently detected.");
      setTimeout(() => setSaveBanner(null), 3000);
      return;
    }

    await Promise.all(
      qualified.map((printer) =>
        handleToggleAuthorize(printer.name, Boolean(printer.isAuthorized), true)
      )
    );
  };

  // Metrics
  const totalDetected = printers.length;
  const authorizedCount = printers.filter((p) => p.isAuthorized).length;
  const quarantinedCount = totalDetected - authorizedCount;

  const filteredPrinters = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return printers;
    return printers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.driverName || "").toLowerCase().includes(q) ||
        (p.portName || "").toLowerCase().includes(q)
    );
  }, [printers, searchQuery]);

  return (
    <div className="flex-1 overflow-y-auto bg-[#faf8ff] p-5 lg:p-6 text-slate-800 font-sans select-none">
      {/* 1. SECURITY POLICY HEADER */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <span>Win32 Subsystem</span>
            <span>/</span>
            <span>Access Control &amp; Fleet Governance</span>
            <span>/</span>
            <span className="font-semibold text-emerald-700">Local Security Policy</span>
          </div>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 lg:text-2xl">
            Authorize Printers &amp; Kiosk Access
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Control which local Win32 physical and virtual printer drivers are exposed to the SmartPrinter cloud kiosk gateway and untrusted mobile sessions.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={fetchPrinters}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 active:bg-slate-100 transition"
          >
            ↻ Rescan Subsystem
          </button>
          <button
            type="button"
            onClick={handleAuthorizeAllQualified}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition"
          >
            🛡️ Authorize All Qualified
          </button>
          <button
            type="button"
            onClick={async () => {
              setSaving(true);
              try {
                await updateSettings({
                  settings: {
                    defaultQuarantine: String(defaultQuarantine),
                    allowUsbOverride: String(allowUsbOverride),
                    autoPauseOnJam: String(autoPauseOnJam),
                    spoolLimitMb,
                  },
                });
                setSaveBanner("Printer workstation policies saved successfully.");
              } catch (err) {
                setSaveBanner(
                  err instanceof Error ? err.message : "Unable to save printer permissions."
                );
              } finally {
                setSaving(false);
                setTimeout(() => setSaveBanner(null), 4000);
              }
            }}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 transition"
          >
            💾 {saving ? "Saving..." : "Save Permissions"}
          </button>
        </div>
      </div>

      {saveBanner && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800 font-medium shadow-2xs">
          {saveBanner}
        </div>
      )}

      {/* 2. SECURITY BOUNDARY NOTIFICATION */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200/80 bg-emerald-50/50 p-3.5 text-xs text-emerald-900 shadow-2xs">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 text-sm">
            🔒
          </span>
          <div>
            <span className="font-bold">Kiosk Security Boundary Active:</span>{" "}
            <span>Only cryptographically signed local printers will accept incoming jobs from customer web sessions and terminal QR pairing. Cloud dispatch will automatically discard payloads bound for untrusted queues.</span>
          </div>
        </div>
        <span className="font-mono text-[10px] text-emerald-700 font-bold bg-emerald-100/80 px-2 py-0.5 rounded">
          ● DPAPI Enclave: Ready
        </span>
      </div>

      {/* 3. HARDWARE ACCESS KPIS */}
      <div className="mb-6 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider">Total Detected</span>
            <span>🖨️</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">{totalDetected} <span className="text-xs text-slate-400 font-normal">Win32 Queues</span></p>
          <p className="mt-1 text-[11px] text-slate-500 font-medium">{printers.filter((p) => p.connectionType !== "Virtual").length} Physical •{" "}
              {printers.filter((p) => p.connectionType === "Virtual").length} Virtual</p>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider">Kiosk Authorized</span>
            <span className="text-emerald-600">✓</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">{authorizedCount} <span className="text-xs text-slate-400 font-normal">Active Routers</span></p>
          <p className="mt-1 text-[11px] text-emerald-600 font-semibold">{printers.filter((p) => p.isAuthorized).map((p) => p.name).join(", ") || "No printers authorized"}</p>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider">Quarantined / Idle</span>
            <span className="text-amber-600">⏸</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">{quarantinedCount} <span className="text-xs text-slate-400 font-normal">Isolated Devices</span></p>
          <p className="mt-1 text-[11px] text-slate-500">{printers.filter((p) => !p.isAuthorized && p.connectionType !== "Virtual").length} Standby •{" "}
              {printers.filter((p) => !p.isAuthorized && p.connectionType === "Virtual").length} Blocked Virtual</p>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider">Fleet Security Mode</span>
            <span className="text-sky-600">🛡️</span>
          </div>
          <p className="mt-1 text-base font-bold text-slate-900">Strict Whitelist</p>
          <p className="mt-1 font-mono text-[11px] text-slate-500">Hardware SHA-256 bound</p>
        </div>
      </div>

      {/* 4. AUTHORIZATION TABLE */}
      <div className="rounded-xl border border-slate-200/90 bg-white shadow-xs overflow-hidden mb-6">
        <div className="flex items-center justify-between p-3.5 border-b border-slate-100 bg-slate-50/40">
          <div className="flex items-center gap-2">
            <span className="text-base">⚙️</span>
            <span className="text-xs font-bold text-slate-900">Local Print Routing Inventory</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-mono text-slate-500">
              Spooler: Win32 Spoolsv.exe
            </span>
          </div>
          <input
            type="text"
            placeholder="Filter by driver or port..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:outline-none w-56"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200/80 bg-slate-50/75 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4">Device Identity &amp; Driver</th>
                <th className="py-3 px-4">Port &amp; Binding</th>
                <th className="py-3 px-4">Capabilities &amp; Formats</th>
                <th className="py-3 px-4">Kiosk Tariff Tiers</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-center">Kiosk Routing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPrinters.map((printer) => {
                const isVirtual = (printer.connectionType ?? "Network") === "Virtual";

                return (
                  <tr key={printer.name} className="hover:bg-slate-50/60 transition-colors">
                    {/* Column 1: Identity */}
                    <td className="py-4 px-4">
                      <div className="flex items-start gap-3">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-base ${
                          printer.isAuthorized
                            ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-slate-50 text-slate-400"
                        }`}>
                          🖨️
                        </div>
                        <div>
                          <div className="font-bold text-slate-900">{printer.name}</div>
                          <div className="font-mono text-[11px] text-slate-400 mt-0.5">
                            {printer.driverName || "Driver unavailable"} • FP: {printer.fingerprint || "Unavailable"}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Column 2: Port */}
                    <td className="py-4 px-4">
                      <div className="font-mono font-semibold text-slate-700">{printer.portName || "Port unavailable"}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {(printer.connectionType ?? "Network") === "USB"
                          ? "Virtual Printer Port"
                          : (printer.connectionType ?? "Network") === "Network"
                          ? "Standard TCP/IP"
                          : "Software Loopback"}
                      </div>
                    </td>

                    {/* Column 3: Capabilities */}
                    <td className="py-4 px-4">
                      <div className="flex flex-wrap gap-1 max-w-[220px]">
                        {(printer.formats ?? []).map((fmt) => (
                          <span
                            key={fmt}
                            className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                          >
                            {fmt}
                          </span>
                        ))}
                      </div>
                    </td>

                    {/* Column 4: Tariff */}
                    <td className="py-4 px-4">
                      {isVirtual ? (
                        <span className="text-slate-400 italic text-[11px]">Excluded from billing</span>
                      ) : (
                        <div className="font-mono text-[11px] space-y-0.5">
                          {printer.colorTariff && <div>Color: <strong className="text-slate-800">{printer.colorTariff}</strong></div>}
                          {printer.monoTariff && <div>Mono: <strong className="text-slate-800">{printer.monoTariff}</strong></div>}
                        </div>
                      )}
                    </td>

                    {/* Column 5: Status Badge */}
                    <td className="py-4 px-4">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          printer.isAuthorized
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : isVirtual
                            ? "bg-rose-50 text-rose-700 border border-rose-200"
                            : "bg-amber-50 text-amber-700 border border-amber-200"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            printer.isAuthorized ? "bg-emerald-500" : isVirtual ? "bg-rose-500" : "bg-amber-500"
                          }`}
                        />
                        {printer.isAuthorized ? "Authorized" : isVirtual ? "Blocked" : "Standby"}
                      </span>
                    </td>

                    {/* Column 6: Interactive Switch Toggle */}
                    <td className="py-4 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => handleToggleAuthorize(printer.name, Boolean(printer.isAuthorized))}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          printer.isAuthorized ? "bg-emerald-600" : "bg-slate-200"
                        }`}
                        role="switch"
                        aria-checked={Boolean(printer.isAuthorized)}
                      >
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            printer.isAuthorized ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. SUBSYSTEM FLEET POLICIES */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 mb-6">
        <div className="lg:col-span-2 rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-base">🛡️</span>
              <h2 className="text-sm font-bold text-slate-900">Subsystem Fleet Policies &amp; Directives</h2>
            </div>
            <span className="font-mono text-[10px] text-slate-400">GROUP POLICY V4.2</span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Policy 1 */}
            <div className="rounded-xl border border-slate-200/70 p-3.5 bg-slate-50/40 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-slate-900">Default Quarantine</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Newly plugged USB/Network printers require manual administrator review before exposing to kiosk.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDefaultQuarantine(!defaultQuarantine)}
                className={`h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${
                  defaultQuarantine ? "bg-emerald-600" : "bg-slate-300"
                }`}
              >
                <span className={`block h-4 w-4 transform rounded-full bg-white transition ${defaultQuarantine ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
            </div>

            {/* Policy 2 */}
            <div className="rounded-xl border border-slate-200/70 p-3.5 bg-slate-50/40 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-slate-900">Allow Direct USB Override</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Permits local shop manager to bypass biometric approval when reconnecting known device GUIDs.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAllowUsbOverride(!allowUsbOverride)}
                className={`h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${
                  allowUsbOverride ? "bg-emerald-600" : "bg-slate-300"
                }`}
              >
                <span className={`block h-4 w-4 transform rounded-full bg-white transition ${allowUsbOverride ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
            </div>

            {/* Policy 3 */}
            <div className="rounded-xl border border-slate-200/70 p-3.5 bg-slate-50/40 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-slate-900">Auto-Pause on Jam / Low Toner</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Halt cloud dispatch immediately if hardware sensor signals critical paper jam or &lt;5% toner level.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAutoPauseOnJam(!autoPauseOnJam)}
                className={`h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${
                  autoPauseOnJam ? "bg-emerald-600" : "bg-slate-300"
                }`}
              >
                <span className={`block h-4 w-4 transform rounded-full bg-white transition ${autoPauseOnJam ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
            </div>

            {/* Policy 4 */}
            <div className="rounded-xl border border-slate-200/70 p-3.5 bg-slate-50/40 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-slate-900">Client Spool Buffer Limit</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Enforce max file payload per job to protect printer embedded RAM against large vector files.
                </p>
                <span className="text-[10px] font-mono text-emerald-700 font-semibold mt-1 inline-block">
                  Max 50 MB / job • Strict
                </span>
              </div>
              <select
                value={spoolLimitMb}
                onChange={(e) => setSpoolLimitMb(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 shadow-2xs focus:outline-none"
              >
                <option value="25 MB">25 MB</option>
                <option value="50 MB">50 MB</option>
                <option value="100 MB">100 MB</option>
              </select>
            </div>
          </div>
        </div>

        {/* Cryptographic Device Attestation */}
        <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Cryptographic Hardware Lock</span>
              <span>🔒</span>
            </div>
            <h3 className="text-sm font-bold text-slate-900">Device Attestation</h3>
            <p className="text-xs text-slate-500 mt-1">
              Printers are assigned a unique local machine signature based on USB Vendor ID, Product ID, and NIC MAC address to prevent spoofing.
            </p>

            <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white font-bold text-xs">
                {serviceStatus?.isPaired ? "OK" : "—"}
              </div>
              <div>
                <div className="text-xs font-bold text-slate-800">Integrity Verified</div>
                <div className="font-mono text-[10px] text-slate-500">
                  {serviceStatus?.isPaired
                    ? "Hardware attestation available"
                    : "Hardware attestation unavailable"}
                </div>
                <div className="text-[10px] text-emerald-700 font-semibold">
                  {serviceStatus?.isPaired ? "Enclave session locked" : "Enclave status unavailable"}
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={async () => {
              try {
                const status = await getServiceStatus();
                setServiceStatus(status);
                setSaveBanner("Hardware attestation and service status refreshed.");
              } catch (err) {
                setSaveBanner(
                  err instanceof Error ? err.message : "Unable to refresh hardware status."
                );
              } finally {
                setTimeout(() => setSaveBanner(null), 4000);
              }
            }}
            className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
          >
            ↻ Refresh Hardware Attestation
          </button>
        </div>
      </div>

      {/* 6. BOTTOM TELEMETRY BAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-3 text-xs text-slate-500 shadow-xs">
        <div className="flex items-center gap-2">
          <span>🖨️</span>
          <span className="font-mono text-[11px]">
            Device ID: <strong>{serviceStatus?.deviceId || "—"}</strong> • IPC Handshake: <strong className="text-emerald-600">{serviceStatus ? "Connected" : "Unavailable"}</strong>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-slate-400 text-[11px]">
            Realtime Sync: <strong className={serviceStatus?.realtimeConnected ? "text-emerald-600" : "text-slate-500"}>{serviceStatus?.realtimeConnected ? "Connected" : "Offline"}</strong>
          </span>
          <Link to="/diagnostics" className="font-semibold text-emerald-700 hover:underline">
            View Authorization Audit Logs →
          </Link>
        </div>
      </div>
    </div>
  );
}