import React, { useState, useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { getPrinters } from "../lib/ipc";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { useAgentStatus } from "../context/AgentStatusContext";

interface NavItem {
  to: string;
  label: string;
  icon: (active: boolean) => React.ReactNode;
  badge?: string | number;
  badgeType?: "neutral" | "emerald" | "amber";
}

export default function Sidebar() {
  const location = useLocation();
  const { session } = useAuth();
  const {
    isOnline,
    isRestarting,
    isStarting,
    status: serviceStatus,
  } = useAgentStatus();

  const [printerCount, setPrinterCount] = useState<number>(0);
  const [shopSlug, setShopSlug] = useState<string>("");

  const activeJobCount = isOnline ? (serviceStatus?.queuedJobCount ?? 0) : 0;
  const agentVersion = isOnline && serviceStatus?.agentVersion ? `v${serviceStatus.agentVersion}` : isRestarting ? "Restarting" : isStarting ? "Connecting" : "Not Running";

  // Fetch printer count only when agent is online, not on an aggressive loop
  useEffect(() => {
    if (!isOnline) {
      setPrinterCount(0);
      return;
    }

    let active = true;
    getPrinters()
      .then((printers) => {
        if (active) setPrinterCount(printers.length);
      })
      .catch(() => {
        if (active) setPrinterCount(0);
      });

    return () => {
      active = false;
    };
  }, [isOnline]);

  useEffect(() => {
    async function loadShopSlug() {
      if (!session) return;
      try {
        // 1. Check branches where user is owner or manager
        const { data: ownedBranch } = await supabase
          .from("branches")
          .select("id")
          .or(`owner_id.eq.${session.user.id},manager_id.eq.${session.user.id}`)
          .limit(1)
          .maybeSingle();

        if (ownedBranch?.id) {
          setShopSlug(ownedBranch.id);
          return;
        }

        // 2. Check user_roles table for branch membership
        const { data: roleRow } = await supabase
          .from("user_roles")
          .select("branch_id")
          .eq("user_id", session.user.id)
          .in("role", ["branch", "branch_owner", "shop_owner"])
          .limit(1)
          .maybeSingle();

        if (roleRow?.branch_id) {
          setShopSlug(roleRow.branch_id);
        }
      } catch (err) {
        console.warn("Could not load branch id for sidebar:", err);
      }
    }
    void loadShopSlug();
  }, [session]);

  const navItems: NavItem[] = [
    {
      to: "/dashboard",
      label: "Dashboard",
      icon: (active) => (
        <svg
          className={`h-4 w-4 transition-colors ${active ? "text-emerald-700" : "text-slate-400 group-hover:text-slate-600"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
        </svg>
      ),
    },
    {
      to: "/printers",
      label: "Printers",
      badge: printerCount > 0 ? `${printerCount}` : undefined,
      badgeType: "neutral",
      icon: (active) => (
        <svg
          className={`h-4 w-4 transition-colors ${active ? "text-emerald-700" : "text-slate-400 group-hover:text-slate-600"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 6 2 18 2 18 9" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" rx="1" />
        </svg>
      ),
    },
    {
      to: "/jobs/active",
      label: "Active Jobs",
      badge: activeJobCount > 0 ? activeJobCount : undefined,
      badgeType: "emerald",
      icon: (active) => (
        <svg
          className={`h-4 w-4 transition-colors ${active ? "text-emerald-700" : "text-slate-400 group-hover:text-slate-600"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      ),
    },
    {
      to: "/jobs/history",
      label: "Job History",
      icon: (active) => (
        <svg
          className={`h-4 w-4 transition-colors ${active ? "text-emerald-700" : "text-slate-400 group-hover:text-slate-600"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
    {
      to: "/printers/status",
      label: "Printer Status",
      badge: printerCount > 0 ? `${printerCount} Online` : undefined,
      badgeType: "neutral",
      icon: (active) => (
        <svg
          className={`h-4 w-4 transition-colors ${active ? "text-emerald-700" : "text-slate-400 group-hover:text-slate-600"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 6 2 18 2 18 9" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" rx="1" />
        </svg>
      ),
    },
    {
      to: "/printers/authorize",
      label: "Authorize Printers",
      icon: (active) => (
        <svg
          className={`h-4 w-4 transition-colors ${active ? "text-emerald-700" : "text-slate-400 group-hover:text-slate-600"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      ),
    },
    {
      to: "/qr",
      label: "QR Code",
      icon: (active) => (
        <svg
          className={`h-4 w-4 transition-colors ${active ? "text-emerald-700" : "text-slate-400 group-hover:text-slate-600"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <path d="M14 14h2v2h-2z" />
          <path d="M18 14h3v3h-3z" />
          <path d="M14 18h3v3h-3z" />
          <path d="M19 19h2v2h-2z" />
        </svg>
      ),
    },
    {
      to: "/subscription",
      label: "Subscription",
      icon: (active) => (
        <svg
          className={`h-4 w-4 transition-colors ${active ? "text-emerald-700" : "text-slate-400 group-hover:text-slate-600"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <line x1="2" y1="10" x2="22" y2="10" />
        </svg>
      ),
    },
    {
      to: "/settings",
      label: "Settings",
      icon: (active) => (
        <svg
          className={`h-4 w-4 transition-colors ${active ? "text-emerald-700" : "text-slate-400 group-hover:text-slate-600"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
    },
    {
      to: "/diagnostics",
      label: "Diagnostics",
      icon: (active) => (
        <svg
          className={`h-4 w-4 transition-colors ${active ? "text-emerald-700" : "text-slate-400 group-hover:text-slate-600"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 17l6-6-6-6" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      ),
    },
  ];

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-slate-200/80 bg-white select-none shrink-0 font-sans shadow-xs">
      {/* 1. BRAND HEADER */}
      <div className="flex h-16 items-center justify-between px-5 border-b border-slate-100/80">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
            <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
              <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold tracking-tight text-slate-900">SmartPrinter</span>
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 tracking-wide uppercase">
                Kiosk
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono">Win32 Spool Suite</p>
          </div>
        </div>
      </div>

      {/* 2. LOCAL AGENT TELEMETRY PILL */}
      <div className="px-4 pt-3.5 pb-2">
        <div className="flex items-center justify-between rounded-lg border border-slate-200/60 bg-slate-50/70 px-2.5 py-1.5 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                isOnline
                  ? "bg-emerald-500 animate-pulse"
                  : isRestarting || isStarting
                  ? "bg-amber-500 animate-pulse"
                  : "bg-rose-500"
              }`}
            />
            <span className="font-semibold text-slate-700">Win32 Agent</span>
          </div>
          <span className="font-mono text-[10px] text-slate-400">{agentVersion}</span>
        </div>
      </div>

      {/* 3. NAVIGATION SECTION */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5 scrollbar-thin">
        <div className="px-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Management
        </div>

        {navItems.map((item) => {
          const isActive = location.pathname === item.to || location.pathname.startsWith(item.to + "/");

          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive: exactActive }) => {
                const active = exactActive || isActive;
                return `group relative flex items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold transition-all duration-150 ${
                  active
                    ? "bg-emerald-50/80 text-emerald-900 font-bold shadow-2xs"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`;
              }}
            >
              {({ isActive: exactActive }) => {
                const active = exactActive || isActive;
                return (
                  <>
                    {/* Left Active Accent Bar */}
                    {active && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-emerald-600" />
                    )}

                    <div className="flex items-center gap-2.5">
                      {item.icon(active)}
                      <span>{item.label}</span>
                    </div>

                    {/* Badge Pill */}
                    {item.badge !== undefined && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-tight ${
                          item.badgeType === "emerald"
                            ? "bg-emerald-100 text-emerald-800"
                            : item.badgeType === "amber"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </>
                );
              }}
            </NavLink>
          );
        })}
      </div>

      {/* 4. FOOTER / USER & UNPAIR SECTION */}
      <div className="border-t border-slate-100 p-3 space-y-2 bg-slate-50/40">
        {/* Workstation Identification */}
        <div className="rounded-xl border border-slate-200/70 bg-white p-2.5 shadow-2xs">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-slate-800">
              {isOnline && serviceStatus?.deviceId ? `STATION-${serviceStatus.deviceId.slice(0, 8)}` : "Station 01"}
            </span>
            <span className={`text-[10px] font-mono font-medium ${
              isOnline
                ? "text-emerald-600"
                : isRestarting || isStarting
                ? "text-amber-600"
                : "text-rose-500"
            }`}>
              {isOnline ? "Ready" : isRestarting ? "Restarting" : isStarting ? "Connecting" : "Offline / Not Running"}
            </span>
          </div>
          <p className="text-[10px] text-slate-400 truncate mt-0.5">
            {shopSlug ? `smartprinter.in/s/${shopSlug}` : "smartprinter.in/setup"}
          </p>
        </div>

        {/* Log out / Unpair Button */}
        <NavLink
          to="/logout"
          className="flex items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-700 transition"
        >
          <div className="flex items-center gap-2">
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Log out / Unpair</span>
          </div>
          <span className="text-[10px] text-slate-400">Esc</span>
        </NavLink>
      </div>
    </aside>
  );
}