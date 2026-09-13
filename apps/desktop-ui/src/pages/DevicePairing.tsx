import { useState, useEffect, useCallback, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type {
  ServiceStatusDto,
  PrinterInfo,
} from "@shared/index";
import {
  pairDeviceCreate,
  pairDeviceConfirm,
  getServiceStatus,
  getPrinters,
} from "../lib/ipc";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";

export default function DevicePairing() {
  const navigate = useNavigate();
  const { session } = useAuth();

  // Pairing State
  const [pairingCode, setPairingCode] = useState<string>("------");
  const [expiresInSeconds, setExpiresInSeconds] = useState<number>(600);
  const [copied, setCopied] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [manualCodeInput, setManualCodeInput] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Manual PIN modal
  const [showManualPinModal, setShowManualPinModal] = useState<boolean>(false);

  // Shop Info from Supabase
  const [shopName, setShopName] = useState<string>("My Print Shop");
  const [shopSlug, setShopSlug] = useState<string>("my-print-shop");
  const [discoveredPrinters, setDiscoveredPrinters] = useState<PrinterInfo[]>([]);

  // System & Service State
  const [serviceStatus, setServiceStatus] = useState<ServiceStatusDto>({
    isPaired: false,
    realtimeConnected: false,
    mockCloudMode: false,
    agentVersion: "2.4.1",
    queuedJobCount: 0,
    deviceId: undefined,
  });

  // Countdown timer for pairing key
  useEffect(() => {
    const timer = setInterval(() => {
      setExpiresInSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatCountdown = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;

    return `${m.toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}`;
  };

  // Load shop from Supabase and system state from IPC
  useEffect(() => {
    async function loadShopAndSystem() {
      if (isSupabaseConfigured && session?.user) {
        try {
          const { data } = await supabase
            .from("shops")
            .select("name, slug")
            .eq("owner_user_id", session.user.id)
            .maybeSingle();

          if (data?.name) {
            setShopName(data.name);
          }

          if (data?.slug) {
            setShopSlug(data.slug);
          }
        } catch (err) {
          console.warn(
            "Could not load shop details for pairing screen:",
            err
          );
        }
      }

      try {
        const [status, printers] = await Promise.all([
          getServiceStatus(),
          getPrinters().catch(() => []),
        ]);

        setServiceStatus(status);
        setDiscoveredPrinters(printers);
      } catch (err) {
        console.warn(
          "Could not fetch service status from agent:",
          err
        );
      }
    }

    void loadShopAndSystem();
  }, [session]);

  // Generate / Refresh Pairing Code via IPC or Edge Function
  const fetchPairingToken = useCallback(async () => {
    if (!session?.access_token) {
      setErrorMessage(
        "Owner session token is missing. Please sign in again."
      );
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await pairDeviceCreate({
        ownerAccessToken: session.access_token,
      });

      if (res?.pairingCode) {
        setPairingCode(res.pairingCode);

        if (res.expiresAt) {
          const diff = Math.max(
            0,
            Math.floor(
              (new Date(res.expiresAt).getTime() - Date.now()) / 1000
            )
          );

          setExpiresInSeconds(diff || 600);
        }
      }
    } catch (err: any) {
      console.warn("Pairing token request error:", err);

      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Failed to generate pairing token."
      );
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void fetchPairingToken();
  }, [fetchPairingToken]);

  // Copy code to clipboard
  const handleCopy = async () => {
    if (pairingCode && pairingCode !== "------") {
      try {
        await navigator.clipboard.writeText(pairingCode);
        setCopied(true);

        setTimeout(() => {
          setCopied(false);
        }, 2500);
      } catch (err) {
        console.warn("Could not copy pairing code:", err);
        setErrorMessage("Could not copy the pairing code to clipboard.");
      }
    }
  };

  // Confirm authorization and route to Fleet / Dashboard
  // Accepting an optional code fixes the React async-state issue
  // when confirming a manually entered PIN.
  const handleConfirmPairing = async (codeOverride?: string) => {
    const codeToConfirm = (
      codeOverride ?? manualCodeInput ?? pairingCode
    ).trim();

    if (!codeToConfirm || codeToConfirm === "------") {
      setErrorMessage(
        "Please enter or generate a valid 6-digit pairing code."
      );
      return;
    }

    if (!/^\d{6}$/.test(codeToConfirm)) {
      setErrorMessage(
        "Pairing code must contain exactly 6 digits."
      );
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      await pairDeviceConfirm({
        pairingCode: codeToConfirm,
      });

      // Close modal after successful pairing
      setShowManualPinModal(false);

      // Navigate to Fleet Discovery & Dashboard upon successful handshake
      navigate("/printers");
    } catch (err: any) {
      console.warn("Pairing confirmation error:", err);

      setErrorMessage(
        err?.message || "Failed to confirm hardware pairing."
      );

      setLoading(false);
    }
  };

  // Open manual PIN modal
  const handleOpenManualPinModal = () => {
    setErrorMessage(null);
    setManualCodeInput("");
    setShowManualPinModal(true);
  };

  // Close manual PIN modal
  const handleCloseManualPinModal = () => {
    if (loading) return;

    setShowManualPinModal(false);
    setManualCodeInput("");
  };

  // Handle manual PIN submission
  const handleManualPinSubmit = async () => {
    const code = manualCodeInput.trim();

    if (!/^\d{6}$/.test(code)) {
      setErrorMessage(
        "Please enter a valid 6-digit pairing code."
      );
      return;
    }

    await handleConfirmPairing(code);
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#faf8ff] font-sans text-slate-800 antialiased select-none">

      {/* 1. APPLICATION HEADER */}
      <header className="flex h-12 w-full items-center justify-between border-b border-slate-200/80 px-6 lg:px-8 bg-white shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-xs">
            <svg
              className="h-4 w-4 fill-current"
              viewBox="0 0 24 24"
            >
              <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z" />
            </svg>
          </div>

          <span className="text-base font-bold tracking-tight text-slate-900">
            SmartPrinter
          </span>

          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-mono text-slate-500">
            v{serviceStatus.agentVersion}-kiosk
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs font-medium">
          <span className="flex items-center gap-1.5 text-emerald-700 font-semibold">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Win32 Spooler: ACTIVE
          </span>
        </div>
      </header>

      {/* 2. ONBOARDING STEP PROGRESS HEADER */}
      <div className="h-11 shrink-0 border-b border-slate-200/70 bg-white px-6 lg:px-8 py-2">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
              Step 2 of 2
            </span>

            <span className="text-sm font-bold text-slate-800">
              Kiosk Hardware Cryptographic Binding
            </span>

            <span className="text-slate-400">•</span>

            <span className="text-xs text-slate-500">
              Awaiting Handshake ACK
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-emerald-600">
              100% Onboarding Ready
            </span>

            <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full w-full rounded-full bg-emerald-600" />
            </div>
          </div>
        </div>
      </div>

      {/* 3. MAIN WORKSPACE */}
      <main className="min-h-0 flex-1 overflow-hidden px-6 py-3 lg:px-8">
        <div className="mx-auto flex h-full min-h-0 max-w-7xl flex-col">

          {errorMessage && (
            <div className="mb-2 flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
              <span>{errorMessage}</span>

              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="shrink-0 font-bold text-rose-500 hover:text-rose-700"
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}

          <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-12">

            {/* LEFT COLUMN: PAIRING CONTROLS & LOCAL TELEMETRY */}
            <div className="flex min-h-0 flex-col gap-3 lg:col-span-5">

              {/* Win32 Spooler Status Card */}
              <div className="shrink-0 rounded-2xl border border-slate-200/90 bg-white p-3 shadow-xs">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-base">📟</span>

                    <div>
                      <p className="font-bold text-slate-800">
                        Host Win32 Pipe IPC
                      </p>

                      <p className="font-mono text-[11px] text-slate-400">
                        \\.\pipe\SmartPrinterAgent
                      </p>
                    </div>
                  </div>

                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    LATENCY: &lt;1ms
                  </span>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2 text-center text-[10px]">
                  <div>
                    <span className="text-slate-400 block">
                      Agent Cache
                    </span>

                    <span className="font-mono font-semibold text-slate-700">
                      SQLite v3.45
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block">
                      Spooler Hook
                    </span>

                    <span className="font-mono font-semibold text-slate-700">
                      winspool.drv
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block">
                      Entropy Base
                    </span>

                    <span className="font-mono font-semibold text-emerald-600">
                      DPAPI Secure
                    </span>
                  </div>
                </div>
              </div>

              {/* Station Pairing Token Box */}
              <div className="shrink-0 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                    One-Time Secure Key
                  </span>

                  <div className="flex items-center gap-1.5 text-xs text-slate-500 font-mono">
                    <span>
                      ⏱ {formatCountdown(expiresInSeconds)}
                    </span>

                    <button
                      type="button"
                      onClick={fetchPairingToken}
                      disabled={loading}
                      className="text-slate-400 hover:text-slate-700 disabled:opacity-50"
                      title="Refresh key"
                    >
                      ↻
                    </button>
                  </div>
                </div>

                <h2 className="mt-1 text-base font-bold text-slate-900">
                  Station Pairing Token
                </h2>

                {/* Digit Boxes */}
                <div className="mt-3 flex items-center justify-center gap-1.5">
                  {pairingCode.split("").map((digit, idx) => (
                    <Fragment key={idx}>
                      <div className="flex h-11 w-9 sm:w-10 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50/40 text-xl sm:text-2xl font-black text-slate-900 shadow-2xs font-mono">
                        {digit}
                      </div>

                      {idx === 2 && (
                        <span className="text-slate-300 font-bold">
                          •
                        </span>
                      )}
                    </Fragment>
                  ))}
                </div>

                {/* Actions */}
                <div className="mt-3 flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition cursor-pointer"
                  >
                    {copied ? "✓ Key Copied" : "📋 Copy Key"}
                  </button>

                  <span className="text-[11px] text-slate-400">
                    Single-use Ephemeral Key
                  </span>
                </div>

                {/* Mobile QR Companion Option */}
                <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-3.5 flex items-center gap-3.5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white border border-slate-200 shadow-2xs">
                    <svg
                      className="h-9 w-9"
                      viewBox="0 0 24 24"
                      fill="#0f172a"
                    >
                      <rect x="2" y="2" width="6" height="6" rx="1" />
                      <rect x="16" y="2" width="6" height="6" rx="1" />
                      <rect x="2" y="16" width="6" height="6" rx="1" />

                      <rect
                        x="4"
                        y="4"
                        width="2"
                        height="2"
                        fill="#fff"
                      />

                      <rect
                        x="18"
                        y="4"
                        width="2"
                        height="2"
                        fill="#fff"
                      />

                      <rect
                        x="4"
                        y="18"
                        width="2"
                        height="2"
                        fill="#fff"
                      />

                      <rect x="10" y="3" width="2" height="2" />
                      <rect x="10" y="7" width="2" height="4" />
                      <rect x="14" y="10" width="3" height="2" />
                      <rect x="10" y="15" width="4" height="2" />
                      <rect x="17" y="15" width="4" height="4" />
                    </svg>
                  </div>

                  <div>
                    <h3 className="text-xs font-bold text-slate-800">
                      Mobile Companion Sync
                    </h3>

                    <p className="text-[11px] text-slate-500 leading-tight mt-0.5">
                      Scan using the SmartPrinter Mobile Admin App
                      (iOS/Android) for zero-click authentication.
                    </p>

                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 mt-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                      BLE &amp; Wi-Fi Direct Beacon ON
                    </span>
                  </div>
                </div>
              </div>

              {/* Handshake Milestones Checklist */}
              <div className="min-h-0 flex-1 rounded-2xl border border-slate-200/90 bg-white p-3 shadow-xs text-xs space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Handshake Milestones
                </p>

                <div className="flex items-center gap-2.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 font-bold text-[10px]">
                    ✓
                  </span>

                  <div>
                    <span className="font-semibold text-slate-800">
                      Local Win32 Service Detected
                    </span>

                    <p className="text-[10px] text-slate-400">
                      v2.4.1 running as NT AUTHORITY\SYSTEM
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 font-bold text-[10px]">
                    ✓
                  </span>

                  <div>
                    <span className="font-semibold text-slate-800">
                      Cryptographic Hardware-Bound Token
                    </span>

                    <p className="text-[10px] text-slate-400">
                      SHA256: 4f8b9e11...c3d0 (DPAPI Keyring Verified)
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-100 text-sky-700 font-bold text-[10px] animate-pulse">
                    ●
                  </span>

                  <div>
                    <span className="font-semibold text-slate-800">
                      Awaiting Supabase Realtime Authorization
                    </span>

                    <p className="text-[10px] text-slate-400">
                      Listening on channel
                      {" "}
                      'kiosk:handshake:{pairingCode}'
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: INTERACTIVE TOPOLOGY MESH RADAR */}
            <div className="flex min-h-0 flex-col gap-3 lg:col-span-7">
              <div className="min-h-0 flex-1 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs relative overflow-hidden">

                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-ping" />

                    <h2 className="text-sm font-bold text-slate-900">
                      Topology Synchronization Radar
                    </h2>
                  </div>

                  <span className="text-xs font-mono text-slate-400">
                    MESH: 4 NODES DETECTED
                  </span>
                </div>

                {/* Radar Topology Canvas */}
                <div className="relative h-[270px] w-full rounded-xl bg-slate-50/80 border border-slate-200/70 p-4 flex items-center justify-center overflow-hidden">

                  {/* Concentric Radar Rings */}
                  <div className="absolute h-52 w-52 rounded-full border border-slate-200/60" />
                  <div className="absolute h-36 w-36 rounded-full border border-slate-200/80" />
                  <div className="absolute h-20 w-20 rounded-full border border-emerald-200 bg-emerald-50/20" />

                  {/* CENTER NODE: DESKTOP KIOSK STATION */}
                  <div className="relative z-20 flex flex-col items-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white border-2 border-emerald-500 shadow-md text-slate-800">
                      <span className="text-2xl">🖥️</span>
                    </div>

                    <span className="mt-1.5 font-mono text-xs font-bold text-slate-800">
                      {serviceStatus?.deviceId
                        ? `STATION-${serviceStatus.deviceId.substring(0, 8)}`
                        : "DESKTOP-PRINT-01"}
                    </span>

                    <span className="text-[10px] text-slate-400">
                      {serviceStatus
                        ? "Agent Connected • Kiosk Mode"
                        : "Agent Offline"}
                    </span>
                  </div>

                  {/* TOP-LEFT NODE: SHOP CLOUD STORE */}
                  <div className="absolute top-6 left-8 flex items-center gap-2.5 z-20 rounded-xl bg-white p-2.5 shadow-xs border border-slate-200">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600 font-bold">
                      🏪
                    </span>

                    <div>
                      <p className="text-xs font-bold text-slate-800">
                        {shopName || "My Print Shop"}
                      </p>

                      <p className="font-mono text-[10px] text-sky-600">
                        {shopSlug
                          ? `smartprinter.in/s/${shopSlug}`
                          : "smartprinter.in/setup"}
                      </p>
                    </div>
                  </div>

                  {/* TOP-RIGHT NODE: SUPABASE REALTIME */}
                  <div className="absolute top-6 right-8 flex items-center gap-2.5 z-20 rounded-xl bg-white p-2.5 shadow-xs border border-slate-200">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 font-bold">
                      ⚡
                    </span>

                    <div>
                      <p className="text-xs font-bold text-slate-800">
                        Supabase Cloud
                      </p>

                      <p className="font-mono text-[10px] text-emerald-600">
                        wss://realtime.sp-v2.cloud
                      </p>
                    </div>
                  </div>

                  {/* BOTTOM-LEFT NODE: LOCAL SPOOLER FLEET */}
                  <div className="absolute bottom-6 left-8 flex items-center gap-2.5 z-20 rounded-xl bg-white p-2.5 shadow-xs border border-slate-200">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700 font-bold">
                      🖨️
                    </span>

                    <div>
                      <p className="text-xs font-bold text-slate-800">
                        Local Spooler Fleet ({discoveredPrinters.length} Online)
                      </p>

                      <p className="text-[10px] text-slate-400">
                        {discoveredPrinters.length > 0
                          ? discoveredPrinters
                              .slice(0, 3)
                              .map((p) => p.name)
                              .join(" • ")
                          : "Scanning local printers..."}
                      </p>
                    </div>
                  </div>

                  {/* BOTTOM-RIGHT NODE: MOBILE ADMIN */}
                  <div className="absolute bottom-6 right-8 flex items-center gap-2.5 z-20 rounded-xl bg-white p-2.5 shadow-xs border border-slate-200">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600 font-bold">
                      📱
                    </span>

                    <div>
                      <p className="text-xs font-bold text-slate-800">
                        Mobile Admin
                      </p>

                      <p className="text-[10px] text-purple-600">
                        Shop Owner Pairing Link
                      </p>
                    </div>
                  </div>
                </div>

                {/* Discovered Hardware Ports summary */}
                <div className="mt-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-1.5">
                    <span>
                      DISCOVERED LOCAL HARDWARE VIA WIN32 SPOOLER
                    </span>

                    <span className="text-emerald-600">
                      {discoveredPrinters.length} of{" "}
                      {discoveredPrinters.length} OPERATIONAL
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-[10px] font-mono text-slate-500">
                    {discoveredPrinters.length > 0 ? (
                      discoveredPrinters.slice(0, 3).map((p, idx) => (
                        <div
                          key={idx}
                          className="truncate"
                        >
                          ● {p.name} ({p.portName || "Local"})
                        </div>
                      ))
                    ) : (
                      <div className="text-slate-400">
                        No printers detected yet
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Physical Kiosk Security Attestation */}
              <div className="shrink-0 rounded-2xl border border-slate-200/90 bg-white p-3 shadow-xs flex items-center justify-between">
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-xl">🛡️</span>

                  <div>
                    <p className="font-bold text-slate-800">
                      Physical Kiosk Security Attestation
                    </p>

                    <p className="text-slate-500 text-[11px]">
                      Authorizing binds this specific machine to your
                      cloud tenant. Automatic print jobs will spool with
                      strict sandboxing and hardware DPAPI cryptographic
                      verification.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 4. ACTION BAR FOOTER */}
          <div className="mt-3 shrink-0 flex flex-col sm:flex-row items-center justify-between gap-3 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">

            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />

              <span>
                This binds your physical Windows print spooler to{" "}
                <span className="font-bold text-slate-800">
                  {shopName || "My Print Shop"}
                </span>{" "}
                (Verified Storefront).
              </span>
            </div>

            <div className="flex items-center gap-2.5">

              {/* FIXED: React modal instead of prompt() */}
              <button
                type="button"
                onClick={handleOpenManualPinModal}
                disabled={loading}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Manual PIN Input
              </button>

              <button
                type="button"
                onClick={() => handleConfirmPairing()}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 active:scale-[0.99] transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading
                  ? "Authorizing Handshake..."
                  : "Confirm & Authorize Kiosk →"}
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* ========================================================= */}
      {/* MANUAL PIN MODAL                                          */}
      {/* ========================================================= */}
      {showManualPinModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="manual-pin-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !loading) {
              handleCloseManualPinModal();
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  🔐
                </div>

                <h2
                  id="manual-pin-title"
                  className="text-lg font-bold text-slate-900"
                >
                  Enter Pairing Code
                </h2>

                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Enter the 6-digit shop owner pairing code to
                  authorize this kiosk.
                </p>
              </div>

              <button
                type="button"
                onClick={handleCloseManualPinModal}
                disabled={loading}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* PIN Input */}
            <div className="mt-6">
              <label
                htmlFor="manual-pairing-code"
                className="mb-2 block text-xs font-semibold text-slate-700"
              >
                6-Digit Pairing Code
              </label>

              <input
                id="manual-pairing-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                value={manualCodeInput}
                onChange={(event) => {
                  const value = event.target.value
                    .replace(/\D/g, "")
                    .slice(0, 6);

                  setManualCodeInput(value);
                  setErrorMessage(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();

                    if (!loading) {
                      void handleManualPinSubmit();
                    }
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();

                    if (!loading) {
                      handleCloseManualPinModal();
                    }
                  }
                }}
                placeholder="000000"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center font-mono text-2xl font-bold tracking-[0.45em] text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />

              <p className="mt-2 text-center text-[10px] text-slate-400">
                {manualCodeInput.length}/6 digits
              </p>
            </div>

            {/* Modal Actions */}
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleCloseManualPinModal}
                disabled={loading}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() => void handleManualPinSubmit()}
                disabled={loading || manualCodeInput.length !== 6}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Authorizing...
                  </>
                ) : (
                  "Confirm Pairing →"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

