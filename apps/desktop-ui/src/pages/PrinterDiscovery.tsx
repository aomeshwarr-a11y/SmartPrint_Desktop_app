import { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  PrinterInfo,
  PrintJobRecord,
  ServiceStatusDto,
} from "@shared/index";

import {
  getServiceStatus,
  getPrinters,
  getJobs,
  printTestPage,
  authorizePrinter,
} from "../lib/ipc";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

interface TestPageProgress {
  printerName: string;
  status: "idle" | "submitting" | "success" | "error";
  message?: string;
}

type AvailabilityFilter =
  | "ALL"
  | "READY"
  | "BUSY"
  | "OFFLINE"
  | "ATTENTION";

interface BranchQuotaInfo {
  id: string;
  name: string;
  slots_total: number;
  slots_taken: number;
}

interface CloudPrinterRow {
  id: string;
  branch_id: string;
  name: string;
  is_active: boolean;
  desktop_agent_id: string | null;
}

export default function PrinterDiscovery() {
  const navigate = useNavigate();
  const { session } = useAuth();

  // ---------------------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------------------

  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [activeJobs, setActiveJobs] = useState<PrintJobRecord[]>([]);

  const [serviceStatus, setServiceStatus] = useState<ServiceStatusDto>({
    isPaired: false,
    realtimeConnected: false,
    mockCloudMode: false,
    agentVersion: "unknown",
    queuedJobCount: 0,
  });

  const [branchQuota, setBranchQuota] = useState<BranchQuotaInfo | null>(null);
  const [cloudPrinters, setCloudPrinters] = useState<CloudPrinterRow[]>([]);

  const [loading, setLoading] = useState<boolean>(true);
  const [discovering, setDiscovering] = useState<boolean>(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<AvailabilityFilter>("ALL");

  const [testPrintState, setTestPrintState] = useState<
    Record<string, TestPageProgress>
  >({});

  const [authorizingPrinter, setAuthorizingPrinter] = useState<string | null>(null);
  const [authBanner, setAuthBanner] = useState<{
    type: "success" | "error" | "limit";
    message: string;
  } | null>(null);

  const [lastTestSuccessPrinter, setLastTestSuccessPrinter] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // FETCH BRANCH SUBSCRIPTION & QUOTA
  // ---------------------------------------------------------------------------

  const fetchBranchQuota = useCallback(async () => {
    if (!isSupabaseConfigured || !session?.user) return;

    try {
      const user = session.user;
      let branchId: string | null = null;

      // 1. Direct branch ownership/management
      const { data: ownedBranch } = await supabase
        .from("branches")
        .select("id, name, slots_total, slots_taken")
        .or(`owner_id.eq.${user.id},manager_id.eq.${user.id}`)
        .limit(1)
        .maybeSingle();

      if (ownedBranch?.id) {
        branchId = ownedBranch.id;
        setBranchQuota({
          id: ownedBranch.id,
          name: ownedBranch.name ?? "My Shop",
          slots_total: Number(ownedBranch.slots_total) || 1,
          slots_taken: Number(ownedBranch.slots_taken) || 0,
        });
      } else {
        // 2. User roles lookup
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
            setBranchQuota({
              id: b.id,
              name: b.name ?? "My Shop",
              slots_total: Number(b.slots_total) || 1,
              slots_taken: Number(b.slots_taken) || 0,
            });
          }
        }
      }

      // 3. Fetch cloud printers for this branch
      if (branchId) {
        const { data: cpData } = await supabase
          .from("printers")
          .select("id, branch_id, name, is_active, desktop_agent_id")
          .eq("branch_id", branchId);

        if (cpData) {
          setCloudPrinters(cpData as CloudPrinterRow[]);
        }
      }
    } catch (err) {
      console.warn("[PrinterDiscovery] Could not load branch quota:", err);
    }
  }, [session]);

  // ---------------------------------------------------------------------------
  // PRINTER DISCOVERY
  // ---------------------------------------------------------------------------

  const discoverPrinters = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) {
        setDiscovering(true);
      }

      setDiscoveryError(null);

      try {
        const [status, discoveredPrinters, jobs] = await Promise.all([
          getServiceStatus(),
          getPrinters(),
          getJobs().catch(() => [] as PrintJobRecord[]),
        ]);

        setServiceStatus(status);
        setPrinters(discoveredPrinters);
        setActiveJobs(jobs);

        // Also refresh cloud quota
        void fetchBranchQuota();
      } catch (err: unknown) {
        console.error(
          "[PrinterDiscovery] Win32 spooler enumeration failed:",
          err
        );

        const message =
          err instanceof Error
            ? err.message
            : "Failed to communicate with local Win32 spooler agent.";

        setDiscoveryError(message);
      } finally {
        setLoading(false);
        setDiscovering(false);
      }
    },
    [fetchBranchQuota]
  );

  // Initial discovery + periodic refresh
  useEffect(() => {
    void discoverPrinters();

    const interval = window.setInterval(() => {
      void discoverPrinters(false);
    }, 6000);

    return () => {
      window.clearInterval(interval);
    };
  }, [discoverPrinters]);

  // ---------------------------------------------------------------------------
  // TEST PRINT (Free local test, zero money, no cloud record)
  // ---------------------------------------------------------------------------

  const handlePrintTestPage = async (printerName: string) => {
    const trimmedPrinterName = printerName?.trim();

    if (!trimmedPrinterName) {
      return;
    }

    setTestPrintState((prev) => ({
      ...prev,
      [trimmedPrinterName]: {
        printerName: trimmedPrinterName,
        status: "submitting",
        message: "Dispatching free local test page to Windows spooler...",
      },
    }));

    try {
      await printTestPage({
        printerName: trimmedPrinterName,
      });

      setTestPrintState((prev) => ({
        ...prev,
        [trimmedPrinterName]: {
          printerName: trimmedPrinterName,
          status: "success",
          message: "Test page spooled successfully! Hardware communication verified.",
        },
      }));

      // Highlight that hardware works and prompt subscription
      setLastTestSuccessPrinter(trimmedPrinterName);

      // Refresh job information
      void discoverPrinters(false);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to submit test page to Windows Print Spooler.";

      setTestPrintState((prev) => ({
        ...prev,
        [trimmedPrinterName]: {
          printerName: trimmedPrinterName,
          status: "error",
          message,
        },
      }));
    } finally {
      window.setTimeout(() => {
        setTestPrintState((prev) => {
          const updated = { ...prev };
          delete updated[trimmedPrinterName];
          return updated;
        });
      }, 8000);
    }
  };

  // ---------------------------------------------------------------------------
  // TOGGLE AUTHORIZE / REVOKE WITH QUOTA ENFORCEMENT
  // ---------------------------------------------------------------------------

  const handleToggleAuthorize = async (printer: PrinterInfo) => {
    const printerName = printer.name;
    const isCurrentlyAuthorized = Boolean(printer.isAuthorized);
    const targetStatus = !isCurrentlyAuthorized;

    const slotsTotal = branchQuota?.slots_total ?? 1;
    const slotsTaken = branchQuota?.slots_taken ?? 0;
    const currentAgentId = serviceStatus.agentId || serviceStatus.deviceId;
    const activeBranchId = branchQuota?.id;

    // 1. Quota Enforcement: if authorizing and already at or above limit, block!
    if (targetStatus && slotsTaken >= slotsTotal) {
      setAuthBanner({
        type: "limit",
        message: `You have reached your printer limit (${slotsTotal} of ${slotsTotal} slots taken). Upgrade your subscription to authorize more printers.`,
      });
      return;
    }

    setAuthorizingPrinter(printerName);
    setAuthBanner(null);

    // Optimistic UI update
    setPrinters((prev) =>
      prev.map((p) =>
        p.name === printerName ? { ...p, isAuthorized: targetStatus } : p
      )
    );

    try {
      // 1. Update local agent SQLite state
      await authorizePrinter({
        printerName,
        authorized: targetStatus,
      });

      // 2. Sync with Supabase cloud
      if (isSupabaseConfigured && activeBranchId) {
        // Find existing printer row in cloud
        const match = cloudPrinters.find(
          (cp) => cp.name?.toLowerCase() === printerName.toLowerCase()
        );

        let printerId = match?.id;

        if (targetStatus) {
          // Authorizing: Link via printer-link edge function or direct record
          if (printerId && currentAgentId) {
            try {
              await supabase.functions.invoke("printer-link", {
                body: {
                  printer_id: printerId,
                  desktop_agent_id: currentAgentId,
                },
              });
            } catch (err) {
              console.warn("[PrinterDiscovery] printer-link invoke warning:", err);
            }
          } else if (!printerId) {
            // Printer not in cloud yet; create it
            try {
              const { data: newP, error: insertError } = await supabase
                .from("printers")
                .insert({
                  branch_id: activeBranchId,
                  name: printerName,
                  status: "online",
                  incident_status: "available",
                  is_active: true,
                  desktop_agent_id: currentAgentId ?? null,
                })
                .select("id")
                .single();

              if (insertError) {
                console.error("[PrinterDiscovery] Failed to insert printer:", {
                  message: insertError.message,
                  details: insertError.details,
                  hint: insertError.hint,
                  code: insertError.code,
                  branchId: activeBranchId,
                  printerName,
                  desktopAgentId: currentAgentId ?? null,
                });
                throw new Error(
                  `Printer could not be added to cloud database: ${insertError.message}`
                );
              }

              if (!newP?.id) {
                throw new Error("Printer was not created in the cloud database.");
              }

              printerId = newP.id;
            } catch (insErr) {
              console.warn("[PrinterDiscovery] Could not insert new cloud printer:", insErr);
            }
          }

          // Update branch slots_taken
          const nextTaken = Math.min(slotsTotal, slotsTaken + 1);
          await supabase
            .from("branches")
            .update({ slots_taken: nextTaken })
            .eq("id", activeBranchId);

          setBranchQuota((prev) =>
            prev ? { ...prev, slots_taken: nextTaken } : prev
          );

          setAuthBanner({
            type: "success",
            message: `Printer "${printerName}" authorized successfully! Ready for customer print orders.`,
          });
        } else {
          // Deauthorizing: Unlink in cloud and free up slot
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
            } catch (unErr) {
              console.warn("[PrinterDiscovery] Cloud unlink warning:", unErr);
            }
          }

          const nextTaken = Math.max(0, slotsTaken - 1);
          await supabase
            .from("branches")
            .update({ slots_taken: nextTaken })
            .eq("id", activeBranchId);

          setBranchQuota((prev) =>
            prev ? { ...prev, slots_taken: nextTaken } : prev
          );

          setAuthBanner({
            type: "success",
            message: `Printer "${printerName}" deauthorized. 1 subscription slot freed.`,
          });
        }
      }

      // Re-fetch cloud state
      void fetchBranchQuota();
    } catch (err: unknown) {
      console.error("[PrinterDiscovery] Authorization toggle failed:", err);
      // Revert optimistic update
      setPrinters((prev) =>
        prev.map((p) =>
          p.name === printerName ? { ...p, isAuthorized: isCurrentlyAuthorized } : p
        )
      );

      setAuthBanner({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Failed to update printer authorization.",
      });
    } finally {
      setAuthorizingPrinter(null);
      window.setTimeout(() => {
        setAuthBanner(null);
      }, 6000);
    }
  };

  // ---------------------------------------------------------------------------
  // METRICS & COMPUTED VALUES
  // ---------------------------------------------------------------------------

  const totalCount = printers.length;

  const readyCount = useMemo(
    () =>
      printers.filter(
        (printer) => printer.availability === "Ready"
      ).length,
    [printers]
  );

  const busyCount = useMemo(
    () =>
      printers.filter(
        (printer) => printer.availability === "Busy"
      ).length,
    [printers]
  );

  const attentionPrinters = useMemo(
    () =>
      printers.filter(
        (printer) =>
          printer.availability === "Offline" ||
          printer.availability === "Error" ||
          printer.availability === "PaperJam" ||
          printer.availability === "PaperOut"
      ),
    [printers]
  );

  const authorizedCount = useMemo(
    () => printers.filter((p) => p.isAuthorized).length,
    [printers]
  );

  const slotsTotal = branchQuota?.slots_total ?? 1;
  const slotsTaken = branchQuota?.slots_taken ?? authorizedCount;
  const isQuotaReached = slotsTaken >= slotsTotal;

  // Plan name display
  const planName = useMemo(() => {
    if (slotsTotal === 1) return "1-Printer Plan (₹499/mo)";
    if (slotsTotal === 2) return "2-Printer Plan (₹899/mo)";
    if (slotsTotal === 3) return "3-Printer Plan (₹1,299/mo)";
    return `${slotsTotal}-Printer Plan`;
  }, [slotsTotal]);

  // ---------------------------------------------------------------------------
  // FILTERING
  // ---------------------------------------------------------------------------

  const filterTabs: {
    id: AvailabilityFilter;
    label: string;
  }[] = [
    { id: "ALL", label: `All (${totalCount})` },
    { id: "READY", label: `Ready (${readyCount})` },
    { id: "BUSY", label: `Busy (${busyCount})` },
    {
      id: "ATTENTION",
      label: `Attention (${attentionPrinters.length})`,
    },
    { id: "OFFLINE", label: "Offline" },
  ];

  const filteredPrinters = useMemo(() => {
    return printers.filter((printer) => {
      const q = searchQuery.trim().toLowerCase();

      const matchesSearch =
        q === "" ||
        printer.name.toLowerCase().includes(q) ||
        printer.driverName.toLowerCase().includes(q) ||
        printer.portName.toLowerCase().includes(q) ||
        printer.fingerprint.toLowerCase().includes(q) ||
        (printer.connectionType || "").toLowerCase().includes(q);

      if (!matchesSearch) {
        return false;
      }

      if (statusFilter === "READY") {
        return printer.availability === "Ready";
      }

      if (statusFilter === "BUSY") {
        return printer.availability === "Busy";
      }

      if (statusFilter === "OFFLINE") {
        return printer.availability === "Offline";
      }

      if (statusFilter === "ATTENTION") {
        return (
          printer.availability === "Error" ||
          printer.availability === "PaperJam" ||
          printer.availability === "PaperOut"
        );
      }

      return true;
    });
  }, [printers, searchQuery, statusFilter]);

  // Helper: Connection Type badge renderer
  const renderConnectionBadge = (type?: string) => {
    const norm = (type || "").toLowerCase();

    if (norm.includes("usb")) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-200">
          <span>🔌</span> USB
        </span>
      );
    }

    if (norm.includes("network") || norm.includes("wi-fi") || norm.includes("lan") || norm.includes("tcp") || norm.includes("ip")) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
          <span>📶</span> Network (Wi-Fi / LAN)
        </span>
      );
    }

    if (norm.includes("bluetooth") || norm.includes("bth")) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-purple-700 border border-purple-200">
          <span>ᛒ</span> Bluetooth
        </span>
      );
    }

    if (norm.includes("virtual") || norm.includes("pdf") || norm.includes("xps")) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
          Virtual / Software
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
        Windows Spooler
      </span>
    );
  };

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  return (
    <div className="flex-1 overflow-y-auto bg-[#faf8ff] p-5 lg:p-6 text-slate-800">
      {/* ------------------------------------------------------------------- */}
      {/* REALTIME STATUS BANNER                                              */}
      {/* ------------------------------------------------------------------- */}
      {!serviceStatus.realtimeConnected && !loading && (
        <div className="mb-5 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 shadow-xs">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-200 font-bold text-amber-800">
              !
            </span>
            <span className="font-semibold">Cloud Realtime Sync Paused:</span>
            <span>
              Desktop agent is running in offline queue mode. Local spooler jobs will execute normally.
            </span>
          </div>
          <Link
            to="/diagnostics"
            className="font-semibold text-amber-800 underline hover:text-amber-950"
          >
            Diagnostics &amp; Logs →
          </Link>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* ACTION BANNER (SUCCESS / LIMIT / ERROR)                             */}
      {/* ------------------------------------------------------------------- */}
      {authBanner && (
        <div
          className={`mb-5 flex items-center justify-between rounded-xl border p-4 text-xs font-medium shadow-xs transition-all ${
            authBanner.type === "limit"
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : authBanner.type === "success"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-rose-300 bg-rose-50 text-rose-900"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <span className="text-base">
              {authBanner.type === "limit"
                ? "⚠️"
                : authBanner.type === "success"
                ? "✓"
                : "✕"}
            </span>
            <span>{authBanner.message}</span>
          </div>

          {authBanner.type === "limit" && (
            <button
              type="button"
              onClick={() => navigate("/subscription")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 shadow-2xs cursor-pointer"
            >
              Upgrade Subscription ↗
            </button>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TEST PRINT SUCCESS & SUBSCRIBE PROMPT                               */}
      {/* ------------------------------------------------------------------- */}
      {lastTestSuccessPrinter && (
        <div className="mb-5 rounded-xl border border-emerald-300 bg-gradient-to-r from-emerald-50 to-teal-50 p-4 text-xs text-emerald-950 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white font-bold text-lg shadow-2xs">
                ✓
              </div>
              <div>
                <p className="font-bold text-sm text-emerald-900">
                  Test Print Successful for &quot;{lastTestSuccessPrinter}&quot;!
                </p>
                <p className="text-emerald-800 text-xs mt-0.5">
                  Your physical printer communication is verified. Choose a subscription tier on smartprinter.in to start accepting paid kiosk orders!
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setLastTestSuccessPrinter(null)}
                className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 cursor-pointer"
              >
                Dismiss
              </button>

              <button
                type="button"
                onClick={() => navigate("/subscription")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 shadow-2xs cursor-pointer"
              >
                Choose Subscription Plan →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* HEADER                                                              */}
      {/* ------------------------------------------------------------------- */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <span>Windows Print Spooler Subsystem</span>
            <span>•</span>
            <span className="flex items-center gap-1.5 font-mono text-[11px]">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  serviceStatus.realtimeConnected
                    ? "bg-emerald-500"
                    : "bg-amber-500"
                }`}
              />
              Agent: {serviceStatus.agentVersion ? `v${serviceStatus.agentVersion}` : "Offline"}
              {serviceStatus.agentId &&
                ` (${serviceStatus.agentId.slice(0, 8)})`}
            </span>
          </div>

          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 lg:text-2xl">
            Printers &amp; Hardware Discovery
          </h1>

          <p className="mt-0.5 text-xs text-slate-500">
            Auto-detects USB, Wi-Fi, Ethernet, and Bluetooth printers via Windows Print Spooler abstraction.
          </p>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => navigate("/printers/authorize")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 active:bg-slate-100"
          >
            Policy &amp; Access Control
          </button>

          <button
            type="button"
            onClick={() => void discoverPrinters(true)}
            disabled={discovering}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 cursor-pointer"
          >
            ↻ {discovering ? "Discovering..." : "Rescan Spooler Fleet"}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* SUBSCRIPTION CAPACITY & QUOTA BANNER                                */}
      {/* ------------------------------------------------------------------- */}
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-base">💳</span>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Subscription Quota &amp; Fleet Licensing
              </span>
              <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-700 border border-emerald-200">
                {planName}
              </span>
            </div>

            <p className="text-sm font-bold text-slate-900">
              Capacity:{" "}
              <span className={isQuotaReached ? "text-amber-600" : "text-emerald-600"}>
                {slotsTaken} of {slotsTotal} Printers Authorized
              </span>
            </p>

            <p className="text-xs text-slate-500">
              {isQuotaReached
                ? "You have reached your printer limit. Upgrade your subscription on smartprinter.in to authorize additional printers."
                : `${slotsTotal - slotsTaken} printer slot(s) available to authorize on this workstation.`}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Progress Bar */}
            <div className="hidden sm:block w-36">
              <div className="flex justify-between text-[10px] font-mono text-slate-400 mb-1">
                <span>Usage</span>
                <span>{Math.round((slotsTaken / Math.max(1, slotsTotal)) * 100)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all ${
                    isQuotaReached ? "bg-amber-500" : "bg-emerald-500"
                  }`}
                  style={{
                    width: `${Math.min(100, (slotsTaken / Math.max(1, slotsTotal)) * 100)}%`,
                  }}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => navigate("/subscription")}
              className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold shadow-xs transition cursor-pointer ${
                isQuotaReached
                  ? "bg-amber-600 text-white hover:bg-amber-700"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {isQuotaReached ? "Upgrade Subscription ↗" : "Manage Subscription ↗"}
            </button>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* FLEET READY CALLOUT (If >= 1 printer authorized)                     */}
      {/* ------------------------------------------------------------------- */}
      {authorizedCount > 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-900 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white font-bold text-sm">
              🖨️
            </span>
            <div>
              <span className="font-bold">Station Active &amp; Cloud Linked:</span>{" "}
              <span>
                {authorizedCount} printer(s) authorized and ready to accept incoming customer prints from web kiosk sessions.
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 shadow-2xs cursor-pointer"
          >
            Go to Dashboard →
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* KPI CARDS                                                           */}
      {/* ------------------------------------------------------------------- */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Total Detected */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Total Detected
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {loading ? "..." : totalCount}
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-emerald-600">
            Win32 Spooler Drivers
          </p>
        </div>

        {/* Authorized */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Authorized Printers
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">
              {loading ? "..." : authorizedCount}
            </span>
            <span className="text-xs text-slate-500">
              / {slotsTotal} Plan Limit
            </span>
          </div>
          <p className="mt-0.5 text-[11px] font-medium text-slate-400">
            {slotsTotal - slotsTaken > 0
              ? `${slotsTotal - slotsTaken} slot(s) available`
              : "All slots utilized"}
          </p>
        </div>

        {/* Spool Availability */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Hardware Ready
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">
              {loading ? "..." : readyCount}
            </span>
            <span className="text-xs text-slate-500">
              / {totalCount} Active
            </span>
          </div>
          <p className="mt-0.5 text-[11px] font-medium text-emerald-600">
            Responsive Ports
          </p>
        </div>

        {/* Attention */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Attention Required
          </p>
          <p
            className={`mt-1 text-2xl font-bold ${
              attentionPrinters.length > 0
                ? "text-amber-600"
                : "text-slate-900"
            }`}
          >
            {loading ? "..." : attentionPrinters.length}
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-slate-400">
            {attentionPrinters.length === 0
              ? "All ports responsive"
              : "Review offline/error ports"}
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* SEARCH + FILTER                                                     */}
      {/* ------------------------------------------------------------------- */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-2.5 shadow-xs">
        <div className="relative min-w-[240px] flex-1">
          <span className="absolute left-3 top-2.5 text-xs text-slate-400">
            🔍
          </span>
          <input
            type="text"
            placeholder="Search printers by name, connection, driver, or port..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50/50 py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        <div className="flex rounded-lg border border-slate-200 bg-slate-50/70 p-1 text-xs font-medium">
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`rounded px-3 py-1 transition-colors cursor-pointer ${
                statusFilter === tab.id
                  ? "bg-emerald-600 font-semibold text-white shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* PRINTER LIST                                                        */}
      {/* ------------------------------------------------------------------- */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-xs text-slate-400">
          <div className="mb-2 inline-block h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
          <p>Enumerating Win32 print subsystem via Named Pipe...</p>
        </div>
      ) : discoveryError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-8 text-center text-xs text-rose-800">
          <p className="mb-1 text-sm font-semibold">
            Win32 Subsystem Communication Error
          </p>
          <p className="mb-3 text-rose-600">{discoveryError}</p>
          <button
            type="button"
            onClick={() => void discoverPrinters(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3.5 py-1.5 font-semibold text-rose-700 shadow-xs hover:bg-rose-50 cursor-pointer"
          >
            Retry Enumeration
          </button>
        </div>
      ) : filteredPrinters.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-slate-700">
            {searchQuery ? "No matching printers found" : "No Printers Attached"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {searchQuery
              ? `No installed printers match "${searchQuery}".`
              : "Verify physical USB, Wi-Fi, Ethernet, or Bluetooth connections in Windows Devices and Printers."}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Clear Search
              </button>
            )}
            <button
              type="button"
              onClick={() => void discoverPrinters(true)}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 cursor-pointer"
            >
              Scan Subsystem
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3.5">
          {filteredPrinters.map((printer: PrinterInfo) => {
            const currentJob = activeJobs.find(
              (job) =>
                job.printerName === printer.name &&
                (job.status === "printing" || job.status === "claimed")
            );

            const isOffline = printer.availability === "Offline";
            const isError =
              printer.availability === "Error" ||
              printer.availability === "PaperJam" ||
              printer.availability === "PaperOut";

            const isVirtual =
              (printer.connectionType || "").toLowerCase().includes("virtual") ||
              printer.name.toLowerCase().includes("pdf") ||
              printer.name.toLowerCase().includes("xps") ||
              printer.name.toLowerCase().includes("onenote");

            const isAuthorized = Boolean(printer.isAuthorized);
            const isBusyAuthorizing = authorizingPrinter === printer.name;
            const testState = testPrintState[printer.name];

            return (
              <div
                key={printer.fingerprint || printer.name}
                className={`rounded-xl border bg-white p-4 shadow-xs transition-all ${
                  isAuthorized
                    ? "border-emerald-300 ring-1 ring-emerald-100 bg-emerald-50/10"
                    : isOffline
                    ? "border-rose-200 bg-rose-50/15"
                    : isError
                    ? "border-amber-200 bg-amber-50/15"
                    : "border-slate-200/90"
                }`}
              >
                {/* Printer Card Header */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {/* Identity & Badges */}
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-xl ${
                        isAuthorized
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 shadow-2xs"
                          : "border-slate-200 bg-slate-50 text-slate-500"
                      }`}
                    >
                      🖨️
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-bold text-slate-900">
                          {printer.name}
                        </h2>

                        {printer.isDefault && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                            DEFAULT
                          </span>
                        )}

                        {renderConnectionBadge(printer.connectionType)}

                        {isAuthorized && (
                          <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 border border-emerald-200">
                            ✓ AUTHORIZED FOR KIOSK
                          </span>
                        )}

                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                          {printer.supportsColor ? "Color" : "Mono"}
                        </span>

                        {printer.supportsDuplex && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                            Duplex
                          </span>
                        )}
                      </div>

                      <p className="mt-1 font-mono text-xs text-slate-400">
                        Driver: {printer.driverName} • Port: {printer.portName}
                      </p>

                      <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                        Fingerprint:{" "}
                        <span className="text-slate-600">
                          {printer.fingerprint || "Generated via Win32 hardware ID"}
                        </span>
                      </p>
                    </div>
                  </div>

                  {/* Right Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Status Badge */}
                    <span
                      className={`rounded px-2.5 py-1 text-xs font-semibold uppercase ${
                        printer.availability === "Ready"
                          ? "bg-emerald-100 text-emerald-800"
                          : printer.availability === "Busy"
                          ? "bg-blue-100 text-blue-800"
                          : isOffline
                          ? "bg-rose-100 text-rose-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {printer.availability}
                    </span>

                    {/* FREE TEST PRINTER BUTTON */}
                    <button
                      type="button"
                      onClick={() => void handlePrintTestPage(printer.name)}
                      disabled={
                        testState?.status === "submitting" || isOffline
                      }
                      title="Sends a free local test page directly to the Windows print spooler. Zero money charged."
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50 cursor-pointer"
                    >
                      {testState?.status === "submitting" ? (
                        <>
                          <span className="h-2.5 w-2.5 animate-spin rounded-full border border-slate-600 border-t-transparent" />
                          Testing...
                        </>
                      ) : (
                        "🖨️ Test Printer"
                      )}
                    </button>

                    {/* AUTHORIZE / REVOKE BUTTON WITH QUOTA GATING */}
                    {isVirtual ? (
                      <span
                        title="Virtual software drivers cannot accept paid customer jobs"
                        className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-400 font-medium cursor-not-allowed"
                      >
                        Virtual Excluded
                      </span>
                    ) : isAuthorized ? (
                      <button
                        type="button"
                        onClick={() => void handleToggleAuthorize(printer)}
                        disabled={isBusyAuthorizing}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 shadow-2xs disabled:opacity-50 cursor-pointer"
                      >
                        {isBusyAuthorizing ? "Updating..." : "Revoke Access"}
                      </button>
                    ) : isQuotaReached ? (
                      <button
                        type="button"
                        onClick={() => navigate("/subscription")}
                        title="Upgrade subscription to authorize more printers"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-300 px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100 shadow-2xs cursor-pointer"
                      >
                        Upgrade Plan to Authorize ↗
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleToggleAuthorize(printer)}
                        disabled={isBusyAuthorizing || isOffline}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 shadow-2xs disabled:opacity-50 cursor-pointer"
                      >
                        {isBusyAuthorizing ? "Authorizing..." : "✓ Authorize for Kiosk"}
                      </button>
                    )}

                    {/* Configure Status */}
                    <button
                      type="button"
                      onClick={() =>
                        navigate(
                          `/printers/status?target=${encodeURIComponent(
                            printer.name
                          )}`
                        )
                      }
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                    >
                      Status →
                    </button>
                  </div>
                </div>

                {/* Test Print Inline Result */}
                {testState && testState.status !== "idle" && (
                  <div
                    className={`mt-3 rounded-lg border px-3 py-2 text-xs flex items-center justify-between ${
                      testState.status === "success"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : testState.status === "error"
                        ? "border-rose-200 bg-rose-50 text-rose-800"
                        : "border-slate-200 bg-slate-50 text-slate-600"
                    }`}
                  >
                    <span>{testState.message}</span>
                    {testState.status === "success" && (
                      <button
                        type="button"
                        onClick={() => navigate("/subscription")}
                        className="font-bold underline ml-2 hover:text-emerald-950 cursor-pointer"
                      >
                        Choose Plan to Start Printing →
                      </button>
                    )}
                  </div>
                )}

                {/* Active Spool Job Telemetry */}
                {currentJob ? (
                  <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
                    <div className="flex items-center justify-between font-medium text-slate-800">
                      <span className="truncate font-mono">
                        Active Job: #{currentJob.spoolerJobId || currentJob.printJobId.slice(0, 8)}{" "}
                        (Status: {currentJob.status})
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Retries: {currentJob.retryCount}
                      </span>
                    </div>
                  </div>
                ) : (
                  !isOffline &&
                  !isError && (
                    <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                      <span>Local spooler channel idle • Ready for jobs</span>
                    </div>
                  )
                )}

                {/* Offline / Error Diagnostic */}
                {(isOffline || isError) && (
                  <div className="mt-3 flex items-center justify-between text-xs text-rose-700 bg-rose-50/50 p-2.5 rounded-lg border border-rose-100">
                    <span>
                      {isOffline
                        ? "Windows print spooler reports printer port unreachable. Verify physical cable or Wi-Fi connectivity."
                        : `Subsystem alert: ${printer.availability}. Check paper trays or device control panel.`}
                    </span>
                    <Link
                      to="/diagnostics"
                      className="font-semibold underline hover:text-rose-900 ml-2 shrink-0"
                    >
                      Diagnostics →
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}