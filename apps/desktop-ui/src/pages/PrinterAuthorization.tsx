import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  printTestPage,
} from "../lib/ipc";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

interface PrinterAuthorizationUi extends PrinterInfo {
  id?: string;
  cloudPrinterId?: string;
  desktopAgentId?: string | null;
  branchId?: string;
  isAuthorized?: boolean;
  colorTariff?: string;
  monoTariff?: string;
  formats?: string[];
  connectionType?: "USB" | "Bluetooth" | "Network (Wi-Fi / LAN)" | "Virtual" | "Windows Printer" | string;
}

interface BranchQuotaInfo {
  id: string;
  name: string;
  slots_total: number;
  slots_taken: number;
}

export default function PrinterAuthorization() {
  const navigate = useNavigate();
  const { session } = useAuth();

  // 1. STATE BOUND DIRECTLY TO REAL IPC CONTRACTS
  const [printers, setPrinters] = useState<PrinterAuthorizationUi[]>([]);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatusDto | null>(null);
  const [branchQuota, setBranchQuota] = useState<BranchQuotaInfo | null>(null);

  // Policy toggles
  const [defaultQuarantine, setDefaultQuarantine] = useState<boolean>(true);
  const [allowUsbOverride, setAllowUsbOverride] = useState<boolean>(true);
  const [autoPauseOnJam, setAutoPauseOnJam] = useState<boolean>(true);
  const [spoolLimitMb, setSpoolLimitMb] = useState<string>("50 MB");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [saveBanner, setSaveBanner] = useState<{
    type: "success" | "limit" | "error";
    message: string;
  } | null>(null);

  const [testingPrinter, setTestingPrinter] = useState<string | null>(null);

  // 2. FETCH PRINTERS AND SERVICE STATUS VIA IPC & SUPABASE
  const fetchPrinters = useCallback(async () => {
    try {
      const [printersRes, statusRes, settingsRes] = await Promise.all([
        getPrinters().catch(() => [] as PrinterInfo[]),
        getServiceStatus().catch(() => null),
        getSettings().catch(() => ({} as Record<string, string | null>)),
      ]);

      const agentId = statusRes?.agentId || statusRes?.deviceId;
      let branchId: string | null = null;
      let branchName = "My Shop";
      let slotsTotal = 1;
      let slotsTaken = 0;

      if (isSupabaseConfigured && session?.user) {
        try {
          const user = session.user;
          // 1. Direct branch lookup
          const { data: ownedBranch } = await supabase
            .from("branches")
            .select("id, name, slots_total, slots_taken")
            .or(`owner_id.eq.${user.id},manager_id.eq.${user.id}`)
            .limit(1)
            .maybeSingle();

          if (ownedBranch?.id) {
            branchId = ownedBranch.id;
            branchName = ownedBranch.name ?? "My Shop";
            slotsTotal = Number(ownedBranch.slots_total) || 1;
            slotsTaken = Number(ownedBranch.slots_taken) || 0;
          } else {
            // 2. Role row lookup
            const { data: roleRow } = await supabase
              .from("user_roles")
              .select("branch_id, branches(id, name, slots_total, slots_taken)")
              .eq("user_id", user.id)
              .in("role", ["branch", "branch_owner", "shop_owner"])
              .limit(1)
              .maybeSingle();

            if (roleRow?.branch_id) {
              branchId = roleRow.branch_id;
              const b = Array.isArray(roleRow.branches)
                ? roleRow.branches[0]
                : roleRow.branches;
              if (b) {
                branchName = b.name ?? "My Shop";
                slotsTotal = Number(b.slots_total) || 1;
                slotsTaken = Number(b.slots_taken) || 0;
              }
            }
          }

          if (branchId) {
            setBranchQuota({
              id: branchId,
              name: branchName,
              slots_total: slotsTotal,
              slots_taken: slotsTaken,
            });
          }
        } catch (err) {
          console.warn("Could not fetch branch quota for authorization:", err);
        }
      }

      let cloudPrinters: any[] = [];
      if (isSupabaseConfigured && branchId) {
        try {
          const { data } = await supabase
            .from("printers")
            .select("id, branch_id, name, is_active, desktop_agent_id")
            .eq("branch_id", branchId);
          if (data) cloudPrinters = data;
        } catch (err) {
          console.warn("Could not fetch printers from Supabase:", err);
        }
      }

      setPrinters(
        printersRes.map((p) => {
          const match = cloudPrinters.find(
            (cp) => cp.name && cp.name.toLowerCase() === p.name.toLowerCase()
          );

          // Associated with this Desktop Agent through desktop_agent_id or local SQLite
          const isLinkedToAgent = Boolean(
            agentId && match?.desktop_agent_id === agentId && match?.is_active
          );
          const isAuthorized =
            Boolean(p.isAuthorized) ||
            isLinkedToAgent ||
            Boolean(match?.is_active && (!match?.desktop_agent_id || match?.desktop_agent_id === agentId));

          const portUpper = (p.portName || "").toUpperCase();
          const driverUpper = (p.driverName || "").toUpperCase();
          const connType = p.connectionType
            ? p.connectionType
            : portUpper.includes("USB") || driverUpper.includes("USB")
            ? "USB"
            : portUpper.includes("BTH") || portUpper.includes("BLUETOOTH") || driverUpper.includes("BLUETOOTH")
            ? "Bluetooth"
            : portUpper.includes("IP") || portUpper.includes("WSD") || portUpper.includes("TCP")
            ? "Network (Wi-Fi / LAN)"
            : "Virtual";

          return {
            ...p,
            id: match?.id,
            cloudPrinterId: match?.id,
            desktopAgentId: match?.desktop_agent_id,
            branchId: match?.branch_id,
            isAuthorized,
            connectionType: connType,
            formats: [
              "PDF",
              "A4",
              p.supportsColor ? "Color" : "Mono",
              p.supportsDuplex ? "Duplex" : "Simplex",
            ],
          };
        })
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
  }, [session]);

  useEffect(() => {
    fetchPrinters();
  }, [fetchPrinters]);

  // 3. TEST PRINTER LOCALLY (Free test page)
  const handleTestPrint = async (printerName: string) => {
    setTestingPrinter(printerName);
    try {
      await printTestPage({ printerName });
      setSaveBanner({
        type: "success",
        message: `Test page spooled to "${printerName}"! Physical hardware communication verified.`,
      });
    } catch (err: any) {
      setSaveBanner({
        type: "error",
        message: err?.message || `Failed to print test page on "${printerName}".`,
      });
    } finally {
      setTestingPrinter(null);
      setTimeout(() => setSaveBanner(null), 5000);
    }
  };

  // 4. TOGGLE AUTHORIZATION WITH STRICT QUOTA ENFORCEMENT
  const handleToggleAuthorize = async (
    printerName: string,
    currentStatus: boolean,
    targetStatus?: boolean
  ) => {
    const newStatus = targetStatus ?? !currentStatus;
    const slotsTotal = branchQuota?.slots_total ?? 1;
    const currentlyAuthorizedCount = printers.filter((p) => p.isAuthorized).length;

    // Strict quota check: block if trying to authorize more than purchased slots
    if (newStatus && currentlyAuthorizedCount >= slotsTotal) {
      setSaveBanner({
        type: "limit",
        message: `You have reached your printer limit (${slotsTotal} of ${slotsTotal} slots taken). Upgrade your subscription to authorize more printers.`,
      });
      return;
    }

    // Optimistic UI update
    setPrinters((prev) =>
      prev.map((p) => (p.name === printerName ? { ...p, isAuthorized: newStatus } : p))
    );

    try {
      // 1. Update local Win32 spooler authorization in agent SQLite
      const payload: AuthorizePrinterRequest = {
        printerName,
        authorized: newStatus,
      };
      await authorizePrinter(payload);

      const targetPrinter = printers.find((p) => p.name === printerName);
      let printerId = targetPrinter?.cloudPrinterId || targetPrinter?.id;
      const currentAgentId = serviceStatus?.agentId || serviceStatus?.deviceId;
      const branchId = branchQuota?.id;

      if (newStatus) {
        // LINKING FLOW
        if (printerId && currentAgentId) {
          try {
            await supabase.functions.invoke("printer-link", {
              body: {
                printer_id: printerId,
                desktop_agent_id: currentAgentId,
              },
            });
          } catch (err) {
            console.warn("printer-link invoke warning:", err);
          }
        } else if (!printerId && branchId) {
          try {
            const { data: newP } = await supabase
              .from("printers")
              .insert({
                branch_id: branchId,
                name: printerName,
                status: "ready",
                is_active: true,
                desktop_agent_id: currentAgentId ?? null,
              })
              .select("id")
              .maybeSingle();

            if (newP?.id) printerId = newP.id;
          } catch (insErr) {
            console.warn("Cloud printer insert warning:", insErr);
          }
        }

        // Update branch slots_taken
        if (branchId) {
          const nextTaken = Math.min(slotsTotal, currentlyAuthorizedCount + 1);
          await supabase
            .from("branches")
            .update({ slots_taken: nextTaken, updated_at: new Date().toISOString() })
            .eq("id", branchId);

          setBranchQuota((prev) =>
            prev ? { ...prev, slots_taken: nextTaken } : prev
          );
        }

        setSaveBanner({
          type: "success",
          message: `Permissions updated: "${printerName}" is now Authorized and linked to this Desktop Agent.`,
        });
      } else {
        // UNLINKING FLOW
        if (printerId) {
          try {
            await supabase
              .from("printers")
              .update({
                desktop_agent_id: null,
                is_active: false,
                updated_at: new Date().toISOString(),
              })
              .eq("id", printerId);
          } catch (dbErr) {
            console.warn("Could not clear desktop_agent_id on unlink:", dbErr);
          }
        }

        if (branchId) {
          const nextTaken = Math.max(0, currentlyAuthorizedCount - 1);
          await supabase
            .from("branches")
            .update({ slots_taken: nextTaken, updated_at: new Date().toISOString() })
            .eq("id", branchId);

          setBranchQuota((prev) =>
            prev ? { ...prev, slots_taken: nextTaken } : prev
          );
        }

        setSaveBanner({
          type: "success",
          message: `Permissions updated: "${printerName}" is now Deauthorized / Unlinked.`,
        });
      }
    } catch (err: any) {
      console.warn("Authorization toggle error:", err);
      // Revert optimistic update
      setPrinters((prev) =>
        prev.map((p) => (p.name === printerName ? { ...p, isAuthorized: currentStatus } : p))
      );
      setSaveBanner({
        type: "error",
        message: err?.message || "Failed to update authorization",
      });
    } finally {
      setTimeout(() => setSaveBanner(null), 5000);
    }
  };

  // Authorize qualified up to the quota limit
  const handleAuthorizeAllQualified = async () => {
    const qualified = printers.filter(
      (p) => p.connectionType !== "Virtual" && !p.isAuthorized
    );

    if (!qualified.length) {
      setSaveBanner({
        type: "success",
        message: "All qualified physical printers are already authorized.",
      });
      setTimeout(() => setSaveBanner(null), 3000);
      return;
    }

    const slotsTotal = branchQuota?.slots_total ?? 1;
    const currentlyAuthorized = printers.filter((p) => p.isAuthorized).length;
    const availableSlots = Math.max(0, slotsTotal - currentlyAuthorized);

    if (availableSlots <= 0) {
      setSaveBanner({
        type: "limit",
        message: `Cannot authorize all printers: Your plan limit (${slotsTotal} printers) is already reached. Upgrade subscription on smartprinter.in.`,
      });
      return;
    }

    const toAuthorize = qualified.slice(0, availableSlots);
    for (const printer of toAuthorize) {
      await handleToggleAuthorize(printer.name, false, true);
    }
  };

  // Metrics
  const totalDetected = printers.length;
  const authorizedCount = printers.filter((p) => p.isAuthorized).length;
  const slotsTotal = branchQuota?.slots_total ?? 1;
  const isLimitReached = authorizedCount >= slotsTotal;

  const planName = useMemo(() => {
    if (slotsTotal === 1) return "1-Printer Plan (₹499/mo)";
    if (slotsTotal === 2) return "2-Printer Plan (₹899/mo)";
    if (slotsTotal === 3) return "3-Printer Plan (₹1,299/mo)";
    return `${slotsTotal}-Printer Plan`;
  }, [slotsTotal]);

  const filteredPrinters = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return printers;
    return printers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.driverName || "").toLowerCase().includes(q) ||
        (p.portName || "").toLowerCase().includes(q) ||
        (p.connectionType || "").toLowerCase().includes(q)
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
            <span className="font-semibold text-emerald-700">Security Policy</span>
          </div>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 lg:text-2xl">
            Authorize Printers &amp; Kiosk Access
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Control which local Win32 physical printers accept customer print orders from cloud kiosks and mobile sessions.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={fetchPrinters}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 active:bg-slate-100 transition cursor-pointer"
          >
            ↻ Rescan Subsystem
          </button>
          <button
            type="button"
            onClick={handleAuthorizeAllQualified}
            disabled={isLimitReached}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
          >
            🛡️ Authorize Qualified
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
                setSaveBanner({
                  type: "success",
                  message: "Printer workstation policies saved successfully.",
                });
              } catch (err) {
                setSaveBanner({
                  type: "error",
                  message:
                    err instanceof Error ? err.message : "Unable to save printer permissions.",
                });
              } finally {
                setSaving(false);
                setTimeout(() => setSaveBanner(null), 4000);
              }
            }}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 transition cursor-pointer"
          >
            💾 {saving ? "Saving..." : "Save Policy"}
          </button>
        </div>
      </div>

      {/* 2. QUOTA & SUBSCRIPTION CALLOUT */}
      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xl">💳</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs text-slate-900">
                  Licensed Capacity: {authorizedCount} / {slotsTotal} Active
                </span>
                <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                  {planName}
                </span>
                {isLimitReached && (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                    LIMIT REACHED
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {isLimitReached
                  ? "You have reached your printer limit. Upgrade your subscription on smartprinter.in to authorize more printers."
                  : `${slotsTotal - authorizedCount} slot(s) remaining for this branch.`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/printers")}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              ← Fleet Discovery
            </button>
            <button
              type="button"
              onClick={() => navigate("/subscription")}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-bold shadow-2xs cursor-pointer ${
                isLimitReached
                  ? "bg-amber-600 text-white hover:bg-amber-700"
                  : "bg-emerald-600 text-white hover:bg-emerald-700"
              }`}
            >
              {isLimitReached ? "Upgrade Plan ↗" : "Subscription Status ↗"}
            </button>
          </div>
        </div>
      </div>

      {saveBanner && (
        <div
          className={`mb-4 flex items-center justify-between rounded-xl border px-4 py-2.5 text-xs font-medium shadow-2xs ${
            saveBanner.type === "limit"
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : saveBanner.type === "success"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-rose-300 bg-rose-50 text-rose-900"
          }`}
        >
          <div className="flex items-center gap-2">
            <span>{saveBanner.type === "limit" ? "⚠️" : saveBanner.type === "success" ? "✓" : "✕"}</span>
            <span>{saveBanner.message}</span>
          </div>
          {saveBanner.type === "limit" && (
            <button
              type="button"
              onClick={() => navigate("/subscription")}
              className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-bold text-white hover:bg-amber-700 cursor-pointer ml-3 shrink-0"
            >
              Upgrade Subscription ↗
            </button>
          )}
        </div>
      )}

      {/* 3. HARDWARE ACCESS KPIS */}
      <div className="mb-6 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider">Total Detected</span>
            <span>🖨️</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">{totalDetected} <span className="text-xs text-slate-400 font-normal">Queues</span></p>
          <p className="mt-1 text-[11px] text-slate-500 font-medium">
            {printers.filter((p) => p.connectionType !== "Virtual").length} Physical •{" "}
            {printers.filter((p) => p.connectionType === "Virtual").length} Virtual
          </p>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider">Kiosk Authorized</span>
            <span className="text-emerald-600">✓</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">{authorizedCount} <span className="text-xs text-slate-400 font-normal">/ {slotsTotal} Limit</span></p>
          <p className="mt-1 text-[11px] text-emerald-600 font-semibold truncate">
            {printers.filter((p) => p.isAuthorized).map((p) => p.name).join(", ") || "No printers authorized"}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider">Available Slots</span>
            <span className="text-amber-600">⏸</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">{Math.max(0, slotsTotal - authorizedCount)} <span className="text-xs text-slate-400 font-normal">Slots Free</span></p>
          <p className="mt-1 text-[11px] text-slate-500">
            {isLimitReached ? "Capacity fully allocated" : "Ready to authorize"}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider">Fleet Security Mode</span>
            <span className="text-sky-600">🛡️</span>
          </div>
          <p className="mt-1 text-base font-bold text-slate-900">Strict Whitelist</p>
          <p className="mt-1 font-mono text-[11px] text-slate-500">Hardware Bound</p>
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
                <th className="py-3 px-4">Connection &amp; Port</th>
                <th className="py-3 px-4">Capabilities</th>
                <th className="py-3 px-4 text-center">Test Hardware</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-center">Kiosk Routing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPrinters.map((printer) => {
                const isVirtual = printer.connectionType === "Virtual";
                const isAuthorized = Boolean(printer.isAuthorized);
                const isTesting = testingPrinter === printer.name;

                return (
                  <tr key={printer.name} className="hover:bg-slate-50/60 transition-colors">
                    {/* Column 1: Identity */}
                    <td className="py-4 px-4">
                      <div className="flex items-start gap-3">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-base ${
                          isAuthorized
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

                    {/* Column 2: Port & Connection */}
                    <td className="py-4 px-4">
                      <div className="font-mono font-semibold text-slate-700">{printer.portName || "Port unavailable"}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {printer.connectionType ?? "Windows Printer"}
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

                    {/* Column 4: Free Test Printer Button */}
                    <td className="py-4 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => void handleTestPrint(printer.name)}
                        disabled={isTesting}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer shadow-2xs"
                      >
                        {isTesting ? "Testing..." : "🖨️ Test"}
                      </button>
                    </td>

                    {/* Column 5: Status Badge */}
                    <td className="py-4 px-4">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          isAuthorized
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : isVirtual
                            ? "bg-rose-50 text-rose-700 border border-rose-200"
                            : "bg-amber-50 text-amber-700 border border-amber-200"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            isAuthorized ? "bg-emerald-500" : isVirtual ? "bg-rose-500" : "bg-amber-500"
                          }`}
                        />
                        {isAuthorized ? "Authorized" : isVirtual ? "Virtual (Blocked)" : "Standby"}
                      </span>
                    </td>

                    {/* Column 6: Interactive Switch Toggle or Upgrade CTA */}
                    <td className="py-4 px-4 text-center">
                      {isVirtual ? (
                        <span className="text-[10px] text-slate-400">Excluded</span>
                      ) : !isAuthorized && isLimitReached ? (
                        <button
                          type="button"
                          onClick={() => navigate("/subscription")}
                          className="rounded-md bg-amber-50 border border-amber-300 px-2 py-1 text-[10px] font-bold text-amber-900 hover:bg-amber-100 cursor-pointer"
                        >
                          Upgrade Plan ↗
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleToggleAuthorize(printer.name, isAuthorized)}
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            isAuthorized ? "bg-emerald-600" : "bg-slate-200"
                          }`}
                          role="switch"
                          aria-checked={isAuthorized}
                        >
                          <span
                            aria-hidden="true"
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              isAuthorized ? "translate-x-5" : "translate-x-0"
                            }`}
                          />
                        </button>
                      )}
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
            <span className="font-mono text-[10px] text-slate-400">POLICY V4.2</span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Policy 1 */}
            <div className="rounded-xl border border-slate-200/70 p-3.5 bg-slate-50/40 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-slate-900">Default Quarantine</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Newly plugged USB/Network printers require manual review before exposing to kiosk.
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
                  Halt cloud dispatch immediately if hardware sensor signals critical paper jam.
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
                  Enforce max file payload per job to protect printer embedded RAM.
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

        {/* Device Attestation */}
        <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Hardware Attestation</span>
              <span>🔒</span>
            </div>
            <h3 className="text-sm font-bold text-slate-900">Device Pairing</h3>
            <p className="text-xs text-slate-500 mt-1">
              Printers are verified by the local .NET Desktop Agent connected to Windows Print Spooler.
            </p>

            <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white font-bold text-xs">
                {serviceStatus?.isPaired ? "OK" : "—"}
              </div>
              <div>
                <div className="text-xs font-bold text-slate-800">Agent Handshake</div>
                <div className="font-mono text-[10px] text-slate-500">
                  {serviceStatus?.isPaired
                    ? "Cryptographic token active"
                    : "Pairing pending"}
                </div>
                <div className="text-[10px] text-emerald-700 font-semibold">
                  {serviceStatus?.isPaired ? "DPAPI Keyring Verified" : "Agent offline"}
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={fetchPrinters}
            className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
          >
            ↻ Refresh Hardware State
          </button>
        </div>
      </div>

      {/* 6. BOTTOM TELEMETRY BAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-3 text-xs text-slate-500 shadow-xs">
        <div className="flex items-center gap-2">
          <span>🖨️</span>
          <span className="font-mono text-[11px]">
            Device ID: <strong>{serviceStatus?.agentId || serviceStatus?.deviceId || "—"}</strong> • IPC Handshake: <strong className="text-emerald-600">{serviceStatus ? "Connected" : "Unavailable"}</strong>
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