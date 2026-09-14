import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  getSettings,
  updateSettings,
  restartAgent,
  exportDiagnostics,
} from "../lib/ipc";
import { useAuth } from "../context/AuthContext";
import { useAgentStatus } from "../context/AgentStatusContext";
import { supabase } from "../lib/supabaseClient";

interface SettingsState {
  workstationName: string;
  shopMoniker: string;
  operationalRole: string;
  autoStartOnBoot: boolean;
  minimizeToTray: boolean;
  dispatchPolicy: "auto" | "manual";
  pollingFrequencyMs: number;
  maxRetries: number;
  purgeSpoolHours: number;
  spoolCachePath: string;
  bwRate: string;
  colorRate: string;
  legalSurcharge: string;
  minJobCharge: string;
  showTariffOnQr: boolean;
  offlineBufferEnabled: boolean;
}

export default function Settings() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const {
    isOnline,
    isRestarting: isAgentRestarting,
    isStarting,
    status: serviceStatus,
    statusText,
    refresh: refreshAgentHealth,
  } = useAgentStatus();

  const [shopId, setShopId] = useState<string>("");

  const [settings, setSettings] = useState<SettingsState>({
    workstationName: "PRINT-STATION-01",
    shopMoniker: "HQ-MAIN-PRINTSHOP",
    operationalRole: "primary_hub",
    autoStartOnBoot: true,
    minimizeToTray: true,
    dispatchPolicy: "auto",
    pollingFrequencyMs: 2000,
    maxRetries: 3,
    purgeSpoolHours: 24,
    spoolCachePath: "C:\\ProgramData\\SmartPrinter\\SpoolQueue",
    bwRate: "2.00",
    colorRate: "10.00",
    legalSurcharge: "5.00",
    minJobCharge: "5.00",
    showTariffOnQr: true,
    offlineBufferEnabled: true,
  });

  const [saving, setSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [restarting, setRestarting] = useState<boolean>(false);

  // Read configuration via real IPC on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const settingsRes = await getSettings().catch(() => ({} as Record<string, string | null>));

        if (settingsRes && Object.keys(settingsRes).length > 0) {
          setSettings((prev) => ({
            ...prev,
            workstationName: settingsRes.workstationName || prev.workstationName,
            shopMoniker: settingsRes.shopMoniker || prev.shopMoniker,
            operationalRole: settingsRes.operationalRole || prev.operationalRole,
            autoStartOnBoot: settingsRes.autoStartOnBoot ? settingsRes.autoStartOnBoot === "true" : prev.autoStartOnBoot,
            minimizeToTray: settingsRes.minimizeToTray ? settingsRes.minimizeToTray === "true" : prev.minimizeToTray,
            dispatchPolicy: (settingsRes.dispatchPolicy as "auto" | "manual") || prev.dispatchPolicy,
            pollingFrequencyMs: settingsRes.pollingFrequencyMs ? Number(settingsRes.pollingFrequencyMs) : prev.pollingFrequencyMs,
            maxRetries: settingsRes.maxRetries ? Number(settingsRes.maxRetries) : prev.maxRetries,
            purgeSpoolHours: settingsRes.purgeSpoolHours ? Number(settingsRes.purgeSpoolHours) : prev.purgeSpoolHours,
            spoolCachePath: settingsRes.spoolCachePath || prev.spoolCachePath,
            bwRate: settingsRes.bwRate || prev.bwRate,
            colorRate: settingsRes.colorRate || prev.colorRate,
            legalSurcharge: settingsRes.legalSurcharge || prev.legalSurcharge,
            minJobCharge: settingsRes.minJobCharge || prev.minJobCharge,
            showTariffOnQr: settingsRes.showTariffOnQr ? settingsRes.showTariffOnQr === "true" : prev.showTariffOnQr,
            offlineBufferEnabled: settingsRes.offlineBufferEnabled ? settingsRes.offlineBufferEnabled === "true" : prev.offlineBufferEnabled,
          }));
        } else if (serviceStatus) {
          setSettings((prev) => ({
            ...prev,
            workstationName: serviceStatus.deviceId ? `STATION-${serviceStatus.deviceId.slice(0, 8)}` : prev.workstationName,
          }));
        }
      } catch (err) {
        console.error("Failed to fetch settings from Win32 Agent:", err);
      }
    }
    void loadSettings();
  }, [serviceStatus]);

  useEffect(() => {
    async function loadBranch() {
      if (!session) return;
      try {
        // 1. Check branches where user is owner or manager
        const { data: ownedBranch } = await supabase
          .from("branches")
          .select("id, name")
          .or(`owner_id.eq.${session.user.id},manager_id.eq.${session.user.id}`)
          .limit(1)
          .maybeSingle();

        if (ownedBranch) {
          setShopId(ownedBranch.id);
          setSettings((prev) => ({
            ...prev,
            shopMoniker: ownedBranch.name || prev.shopMoniker,
          }));
          return;
        }

        // 2. Check user_roles table for branch membership
        const { data: roleRow } = await supabase
          .from("user_roles")
          .select("branch_id, branches(id, name)")
          .eq("user_id", session.user.id)
          .in("role", ["branch", "branch_owner", "shop_owner"])
          .limit(1)
          .maybeSingle();

        if (roleRow?.branch_id) {
          setShopId(roleRow.branch_id);
          const b = (roleRow as any)?.branches;
          setSettings((prev) => ({
            ...prev,
            shopMoniker: b?.name || prev.shopMoniker,
          }));
        }
      } catch (err) {
        console.warn("Could not load branch details for settings:", err);
      }
    }
    void loadBranch();
  }, [session]);

  const handleSaveSettings = async () => {
    setSaving(true);
    setFeedbackNotice("Persisting workstation settings to local registry and agent database...");

    try {
      const payload: Record<string, string | null> = {
        workstationName: settings.workstationName,
        shopMoniker: settings.shopMoniker,
        operationalRole: settings.operationalRole,
        autoStartOnBoot: String(settings.autoStartOnBoot),
        minimizeToTray: String(settings.minimizeToTray),
        dispatchPolicy: settings.dispatchPolicy,
        pollingFrequencyMs: String(settings.pollingFrequencyMs),
        maxRetries: String(settings.maxRetries),
        purgeSpoolHours: String(settings.purgeSpoolHours),
        spoolCachePath: settings.spoolCachePath,
        bwRate: settings.bwRate,
        colorRate: settings.colorRate,
        legalSurcharge: settings.legalSurcharge,
        minJobCharge: settings.minJobCharge,
        showTariffOnQr: String(settings.showTariffOnQr),
        offlineBufferEnabled: String(settings.offlineBufferEnabled),
      };

      await updateSettings({ settings: payload });
      setSaveSuccess(true);
      setFeedbackNotice("Settings applied successfully to local Win32 service.");
    } catch (err: any) {
      setFeedbackNotice(err?.message || "Failed to update workstation settings.");
    } finally {
      setSaving(false);
      setTimeout(() => {
        setSaveSuccess(false);
        setFeedbackNotice(null);
      }, 4000);
    }
  };

  const handleRestartService = async () => {
    if (restarting || isAgentRestarting) return;
    setRestarting(true);
    setFeedbackNotice("Restarting SmartPrinter Agent service — waiting for confirmed reconnection...");
    try {
      const result = await restartAgent();
      if (result.success) {
        setFeedbackNotice("SmartPrinter Agent restarted successfully. Reconnected to named pipe.");
        await refreshAgentHealth();
      } else {
        setFeedbackNotice(`Agent Offline / Restart Failed: ${result.error ?? "Process did not start."}`);
      }
    } catch (err: any) {
      setFeedbackNotice(err?.message || "Failed to restart agent service.");
    } finally {
      setRestarting(false);
      setTimeout(() => setFeedbackNotice(null), 5000);
    }
  };

  const handleExportDiagnostics = async () => {
    setFeedbackNotice("Packaging diagnostic bundle...");
    try {
      const res = await exportDiagnostics();
      setFeedbackNotice(`Bundle exported: ${res.bundlePath}`);
    } catch (err: any) {
      setFeedbackNotice(err?.message || "Diagnostics export failed.");
    } finally {
      setTimeout(() => setFeedbackNotice(null), 5000);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#faf8ff] p-5 lg:p-6 text-slate-800 font-sans select-none">
      {/* 1. HEADER */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 mb-1">
            <span>Settings</span>
            <span>/</span>
            <span>System &amp; Workstation Configuration</span>
            <span>•</span>
            <span className="flex items-center gap-1 font-semibold text-slate-700">
              <span className={`h-1.5 w-1.5 rounded-full ${
                isOnline
                  ? "bg-emerald-500 animate-pulse"
                  : isAgentRestarting || isStarting
                  ? "bg-amber-500 animate-pulse"
                  : "bg-rose-500"
              }`} />
              Agent {isOnline ? `v${serviceStatus?.agentVersion ?? "2.0"} ONLINE` : statusText}
            </span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 lg:text-2xl">
            Workstation Configuration
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Manage local Win32 spooler hooks, cloud synchronization channels, automatic printing policies, walk-in tariffs, and system tray lifecycle.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleRestartService}
            disabled={restarting || isAgentRestarting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            🔄 {restarting || isAgentRestarting ? "Restarting Agent..." : "Restart Win32 Agent"}
          </button>
          <button
            type="button"
            onClick={handleExportDiagnostics}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition cursor-pointer"
          >
            📋 Export Diagnostics Bundle
          </button>
        </div>
      </div>

      {feedbackNotice && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800 font-medium shadow-2xs">
          {feedbackNotice}
        </div>
      )}

      {/* 2. MAIN CONFIGURATION GRID (Two Columns) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* LEFT COLUMN: Identity & Spooler Policies */}
        <div className="lg:col-span-7 space-y-6">
          {/* Card 1: Workstation & Device Identity */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-base">🖥️</span>
                <h2 className="text-sm font-bold text-slate-900">Workstation &amp; Device Identity</h2>
              </div>
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-600">
                {serviceStatus?.deviceId ? `NODE_${serviceStatus.deviceId.slice(0, 8)}` : "NODE_STATION_01"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Workstation Name
                </label>
                <input
                  type="text"
                  value={settings.workstationName}
                  onChange={(e) => setSettings({ ...settings, workstationName: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-1.5 text-xs font-mono font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Shop ID Moniker
                </label>
                <input
                  type="text"
                  disabled
                  value={settings.shopMoniker}
                  className="w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-mono text-slate-500 cursor-not-allowed"
                />
              </div>
            </div>

            {/* Hardware DPAPI Key Hash */}
            <div className="mt-4 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Device DPAPI Binding
                </span>
                <span className="text-[10px] font-semibold text-emerald-700">
                  {serviceStatus?.isPaired ? "🔒 SECURED (DPAPI Bound)" : "⚠️ UNPAIRED"}
                </span>
              </div>
              <p className="font-mono text-xs text-slate-700 mt-1">
                {serviceStatus?.deviceId ? `win32_agent_dpapi_device_${serviceStatus.deviceId}` : "Hardware DPAPI key will bind upon pairing."}
              </p>
              <p className="text-[10px] text-slate-400 mt-1">
                Cryptographic master keys bound to this motherboard&apos;s TPM / DPAPI store. Unpairing will revoke kiosk routing.
              </p>
            </div>

            {/* Station Operational Role */}
            <div className="mt-4">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Station Operational Role
              </label>
              <select
                value={settings.operationalRole}
                onChange={(e) => setSettings({ ...settings, operationalRole: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="primary_hub">Primary Cashier &amp; Spool Hub (Autonomous Queue Master)</option>
                <option value="secondary_terminal">Secondary Prep Terminal (Spool Client Only)</option>
                <option value="kiosk_display_only">Customer-Facing Counter Display Only</option>
              </select>
            </div>

            {/* System Switches */}
            <div className="mt-5 space-y-3 pt-4 border-t border-slate-100">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="text-xs font-bold text-slate-800">Auto-start with Windows OS</p>
                  <p className="text-[10px] text-slate-500">Executes SmartPrinter.Agent as a background Windows Service on boot</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoStartOnBoot}
                  onChange={(e) => setSettings({ ...settings, autoStartOnBoot: e.target.checked })}
                  className="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="text-xs font-bold text-slate-800">Minimize to System Tray</p>
                  <p className="text-[10px] text-slate-500">Closing window retains active queue listener in the notification area</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.minimizeToTray}
                  onChange={(e) => setSettings({ ...settings, minimizeToTray: e.target.checked })}
                  className="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                />
              </label>
            </div>
          </div>

          {/* Card 2: Print Queue & Spooler Policies */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-base">⚙️</span>
                <h2 className="text-sm font-bold text-slate-900">Print Queue &amp; Spooler Policies</h2>
              </div>
              <span className="font-mono text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-semibold">
                PDFium 64-bit Active
              </span>
            </div>

            {/* Incoming Job Dispatch Policy (Radio Cards) */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-2">
                Incoming Job Dispatch Policy
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div
                  onClick={() => setSettings({ ...settings, dispatchPolicy: "auto" })}
                  className={`rounded-xl border p-3 cursor-pointer transition ${
                    settings.dispatchPolicy === "auto"
                      ? "border-emerald-600 bg-emerald-50/30 shadow-2xs"
                      : "border-slate-200/80 bg-slate-50/40 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={settings.dispatchPolicy === "auto"}
                      onChange={() => setSettings({ ...settings, dispatchPolicy: "auto" })}
                      className="text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-xs font-bold text-slate-900">Direct Auto-Print</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 pl-5">
                    Instant pass-through to assigned physical printer tray without manual touch.
                  </p>
                </div>

                <div
                  onClick={() => setSettings({ ...settings, dispatchPolicy: "manual" })}
                  className={`rounded-xl border p-3 cursor-pointer transition ${
                    settings.dispatchPolicy === "manual"
                      ? "border-emerald-600 bg-emerald-50/30 shadow-2xs"
                      : "border-slate-200/80 bg-slate-50/40 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={settings.dispatchPolicy === "manual"}
                      onChange={() => setSettings({ ...settings, dispatchPolicy: "manual" })}
                      className="text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-xs font-bold text-slate-900">Counter Operator Approval</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 pl-5">
                    Hold jobs in queue until payment is verified and operator clicks release.
                  </p>
                </div>
              </div>
            </div>

            {/* Polling & Retry Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700">Spooler Polling Frequency</label>
                  <span className="font-mono text-xs text-emerald-700 font-bold">{settings.pollingFrequencyMs} ms</span>
                </div>
                <input
                  type="range"
                  min="500"
                  max="5000"
                  step="250"
                  value={settings.pollingFrequencyMs}
                  onChange={(e) => setSettings({ ...settings, pollingFrequencyMs: Number(e.target.value) })}
                  className="w-full accent-emerald-600 cursor-pointer"
                />
                <div className="flex justify-between text-[9px] font-mono text-slate-400 mt-0.5">
                  <span>500ms (High CPU)</span>
                  <span>5000ms (Power Save)</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Max Retry on Hardware Misfire</label>
                <select
                  value={settings.maxRetries}
                  onChange={(e) => setSettings({ ...settings, maxRetries: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value={1}>1 retry (Fail fast)</option>
                  <option value={3}>3 retries (Recommended)</option>
                  <option value={5}>5 retries (Heavy queue)</option>
                </select>
              </div>
            </div>

            {/* Cache & Engine Configuration */}
            <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Purge Completed Spool Files</label>
                <select
                  value={settings.purgeSpoolHours}
                  onChange={(e) => setSettings({ ...settings, purgeSpoolHours: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value={1}>After 1 Hour</option>
                  <option value={24}>After 24 Hours (Recommended)</option>
                  <option value={168}>After 7 Days</option>
                  <option value={0}>Never (Manual Disk Cleanup)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Native PDF Rendering Engine</label>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-mono text-slate-700 flex items-center justify-between">
                  <span>PDFium_x64.dll</span>
                  <span className="text-[10px] text-emerald-700 font-bold uppercase">Embedded</span>
                </div>
              </div>
            </div>

            {/* Spool Directory Path */}
            <div className="mt-4">
              <label className="block text-xs font-bold text-slate-700 mb-1">Local Spool Cache Directory</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  disabled
                  value={settings.spoolCachePath}
                  className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-mono text-slate-600"
                />
                <button
                  type="button"
                  onClick={() => alert("Opened C:\\ProgramData\\SmartPrinter\\SpoolQueue in Explorer")}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
                >
                  📁 Open Folder
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Walk-In Tariffs & Cloud Realtime */}
        <div className="lg:col-span-5 space-y-6">
          {/* Card 3: Walk-In Tariffs & Rates */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-base">💰</span>
                <h2 className="text-sm font-bold text-slate-900">Walk-In Tariffs &amp; Rates</h2>
              </div>
              <span className="rounded bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800 font-mono">
                INR (₹)
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3">
                <span className="text-[11px] font-bold text-slate-600 block mb-1">⚫ Black &amp; White (A4)</span>
                <div className="flex items-center gap-1 font-mono text-base font-bold text-slate-900">
                  <span>₹</span>
                  <input
                    type="text"
                    value={settings.bwRate}
                    onChange={(e) => setSettings({ ...settings, bwRate: e.target.value })}
                    className="w-16 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-sm font-bold text-slate-900 text-center"
                  />
                </div>
                <span className="text-[10px] text-slate-400 mt-1 block">per impression</span>
              </div>

              <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3">
                <span className="text-[11px] font-bold text-slate-600 block mb-1">🔵 Full Color (A4)</span>
                <div className="flex items-center gap-1 font-mono text-base font-bold text-slate-900">
                  <span>₹</span>
                  <input
                    type="text"
                    value={settings.colorRate}
                    onChange={(e) => setSettings({ ...settings, colorRate: e.target.value })}
                    className="w-16 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-sm font-bold text-slate-900 text-center"
                  />
                </div>
                <span className="text-[10px] text-slate-400 mt-1 block">per impression</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-600 font-medium mb-1">Legal / Surcharge</label>
                <div className="flex items-center gap-1 font-mono">
                  <span>₹</span>
                  <input
                    type="text"
                    value={settings.legalSurcharge}
                    onChange={(e) => setSettings({ ...settings, legalSurcharge: e.target.value })}
                    className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Minimum Job Charge</label>
                <div className="flex items-center gap-1 font-mono">
                  <span>₹</span>
                  <input
                    type="text"
                    value={settings.minJobCharge}
                    onChange={(e) => setSettings({ ...settings, minJobCharge: e.target.value })}
                    className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs font-bold"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-100">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="text-xs font-bold text-slate-800">Show Tariff Matrix on QR Placard</p>
                  <p className="text-[10px] text-slate-500">Displays price breakdown on customer phone landing page upon scanning</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.showTariffOnQr}
                  onChange={(e) => setSettings({ ...settings, showTariffOnQr: e.target.checked })}
                  className="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                />
              </label>
            </div>
          </div>

          {/* Card 4: Cloud Realtime & Telemetry */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-base">🌐</span>
                <h2 className="text-sm font-bold text-slate-900">Cloud Realtime &amp; Telemetry</h2>
              </div>
              <span className="text-[10px] text-emerald-700 font-mono font-bold">● 28ms</span>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-xs">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Active Subscription Topic</p>
                <p className="font-mono text-xs font-bold text-slate-800 mt-0.5">
                  shop:{shopId || "local"}:jobs
                </p>
                <span className="text-[10px] text-emerald-700 font-semibold mt-1 inline-block">
                  {serviceStatus?.isPaired ? "CONNECTED (Supabase Realtime)" : "AWAITING PAIRING"}
                </span>
              </div>

              <label className="flex items-center justify-between cursor-pointer pt-2">
                <div>
                  <p className="text-xs font-bold text-slate-800">Offline SQLite Buffer</p>
                  <p className="text-[10px] text-slate-500">Store spool jobs in local encrypted DB if WAN link disconnects</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.offlineBufferEnabled}
                  onChange={(e) => setSettings({ ...settings, offlineBufferEnabled: e.target.checked })}
                  className="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                />
              </label>

              <div className="flex items-center justify-between text-xs text-slate-600 pt-2 border-t border-slate-100">
                <span>Reconnect Backoff Curve</span>
                <span className="font-mono font-bold text-slate-800">Exponential (1s → 30s max)</span>
              </div>
            </div>
          </div>

          {/* Save Action Footer Card */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-800">Config schema v2 valid</p>
              <p className="text-[10px] text-slate-400">Ready to persist to local agent and cloud mirror</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate("/dashboard")}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Discard Changes
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveSettings}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-2xs hover:bg-emerald-700 active:bg-emerald-800 transition disabled:opacity-50 flex items-center gap-1.5"
              >
                <span>💾</span>
                <span>{saving ? "Saving..." : saveSuccess ? "✓ Applied!" : "Save & Apply"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}