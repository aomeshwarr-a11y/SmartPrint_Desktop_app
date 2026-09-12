import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { unpairDevice } from "../lib/ipc";

type ElectronApi = {
  ipcRenderer?: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  };
};

type DeviceInfo = {
  hostname?: string;
  ipAddress?: string;
  nodeId?: string;
  organizationName?: string;
  organizationId?: string;
  tenantId?: string;
  deviceId?: string;
  credentialStatus?: string;
  agentStatus?: string;
};

const getElectronApi = (): ElectronApi | null => {
  if (typeof window === "undefined") {
    return null;
  }

  return (
    (window as Window & { electron?: ElectronApi }).electron ??
    null
  );
};

const getErrorMessage = (
  error: unknown,
  fallback: string
): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
};

export default function Logout() {
  const { signOut, session } = useAuth();
  const navigate = useNavigate();

  const [unpairing, setUnpairing] = useState(false);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [actionError, setActionError] = useState<string | null>(
    null
  );
  const [deviceInfo, setDeviceInfo] =
    useState<DeviceInfo | null>(null);
  const [loadingDevice, setLoadingDevice] = useState(false);

  const currentUserEmail =
    session?.user?.email ?? "No authenticated user";

  const userInitials = useMemo(() => {
    if (!session?.user?.email) {
      return "?";
    }

    const email = session.user.email.trim();

    if (!email) {
      return "?";
    }

    const localPart = email.split("@")[0];

    if (!localPart) {
      return "?";
    }

    const parts = localPart
      .split(/[._-\s]+/)
      .filter(Boolean);

    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }

    return localPart.slice(0, 2).toUpperCase();
  }, [session?.user?.email]);

  const displayValue = (
    value: string | undefined,
    fallback = "Unavailable"
  ) => {
    return value?.trim() ? value : fallback;
  };

  const loadDeviceInfo = async () => {
    const electron = getElectronApi();

    if (!electron?.ipcRenderer) {
      return;
    }

    setLoadingDevice(true);

    try {
      const result = await electron.ipcRenderer.invoke(
        "GetDeviceInfo"
      );

      if (result && typeof result === "object") {
        setDeviceInfo(result as DeviceInfo);
      }
    } catch {
      // Device information is optional.
      // Do not block logout/unpair operations if unavailable.
    } finally {
      setLoadingDevice(false);
    }
  };

  React.useEffect(() => {
    void loadDeviceInfo();
  }, []);

  async function handleSignOut() {
    setActionError(null);

    try {
      await signOut();
      navigate("/");
    } catch (err) {
      setActionError(
        getErrorMessage(
          err,
          "Could not sign out of the current session."
        )
      );
    }
  }

  async function handleUnpair() {
    setUnpairing(true);
    setActionError(null);

    try {
      await unpairDevice();
      navigate("/pairing");
    } catch (err) {
      setActionError(
        getErrorMessage(
          err,
          "Failed to deauthorize and unpair this workstation."
        )
      );

      setUnpairing(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#faf8ff] p-5 font-sans text-slate-800 select-none lg:p-6">
      {/* HEADER */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
            <span>System Settings</span>

            <span>/</span>

            <span className="font-bold text-slate-700">
              Logout &amp; Unpair
            </span>

            <span>•</span>

            <span className="font-mono text-[11px] font-bold uppercase text-emerald-700">
              DEVICE SECURITY PROTOCOL
            </span>
          </div>

          <h1 className="text-xl font-bold tracking-tight text-slate-900 lg:text-2xl">
            Account &amp; Workstation Deauthorization
          </h1>

          <p className="mt-0.5 text-xs text-slate-500">
            Manage the active owner session and device pairing
            credentials for this workstation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 font-mono text-xs text-slate-500">
            DEVICE SECURITY
          </span>
        </div>
      </div>

      {/* ERROR */}
      {actionError && (
        <div className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-medium text-rose-800 shadow-2xs">
          <span>Notice: {actionError}</span>

          <button
            type="button"
            onClick={() => setActionError(null)}
            className="cursor-pointer text-rose-500 hover:text-rose-700"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* WORKSTATION IDENTIFICATION */}
      <div className="mb-6 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">
        <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-3">
          {/* HOST */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              🖥️
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-bold text-slate-900">
                  {loadingDevice
                    ? "Loading..."
                    : displayValue(deviceInfo?.hostname)}
                </span>

                <span className="text-[10px] font-mono text-slate-400">
                  HOST
                </span>
              </div>

              <p className="truncate font-mono text-[11px] text-slate-500">
                {displayValue(deviceInfo?.nodeId)}
                {deviceInfo?.ipAddress
                  ? ` • ${deviceInfo.ipAddress}`
                  : ""}
              </p>
            </div>
          </div>

          {/* ORGANIZATION */}
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Bound Organization
            </span>

            <p className="mt-0.5 text-xs font-bold text-slate-900">
              {displayValue(deviceInfo?.organizationName)}
            </p>

            <p className="font-mono text-[10px] text-slate-400">
              {deviceInfo?.organizationId
                ? `organization: ${deviceInfo.organizationId}`
                : "Organization ID unavailable"}
            </p>

            {deviceInfo?.tenantId && (
              <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                tenant: {deviceInfo.tenantId}
              </p>
            )}
          </div>

          {/* DEVICE CREDENTIAL */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Device Credential
              </span>

              <span
                className={`whitespace-nowrap text-[10px] font-bold ${
                  deviceInfo?.credentialStatus
                    ?.toLowerCase()
                    .includes("active")
                    ? "text-emerald-700"
                    : "text-slate-500"
                }`}
              >
                ●{" "}
                {displayValue(
                  deviceInfo?.credentialStatus,
                  "Status unavailable"
                )}
              </span>
            </div>

            <p className="mt-0.5 truncate rounded border border-slate-100 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-700">
              {displayValue(
                deviceInfo?.deviceId,
                "Device credential identifier unavailable"
              )}
            </p>
          </div>
        </div>
      </div>

      {/* DUAL ACTION CARDS */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* SIGN OUT */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs">
          <div>
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">👤</span>

                <h2 className="text-base font-bold text-slate-900">
                  Sign Out of Account
                </h2>
              </div>

              <span className="rounded border border-sky-100 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-800">
                Safe Action
              </span>
            </div>

            <p className="text-xs leading-relaxed text-slate-600">
              Signs you out of the currently authenticated owner
              account on this computer. Device pairing is not
              removed by this action.
            </p>

            {/* CURRENT USER */}
            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Authenticated Shop Owner
              </span>

              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-[11px] font-bold text-white">
                    {userInitials}
                  </div>

                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-slate-800">
                      {currentUserEmail}
                    </p>

                    <p className="text-[10px] text-slate-400">
                      Authenticated session
                    </p>
                  </div>
                </div>

                <span className="whitespace-nowrap rounded bg-emerald-50 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-800">
                  SESSION ACTIVE
                </span>
              </div>
            </div>

            {/* EFFECTS */}
            <div className="mt-4 space-y-2 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <span className="font-bold text-emerald-600">
                  ✓
                </span>
                <span>Device pairing remains intact</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="font-bold text-emerald-600">
                  ✓
                </span>
                <span>Workstation credentials remain paired</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="font-bold text-emerald-600">
                  ✓
                </span>
                <span>Background agent is not explicitly unpaired</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-400">
                  ↻
                </span>
                <span>Current authentication session is cleared</span>
              </div>
            </div>
          </div>

          <div className="mt-6 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white py-2.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 active:bg-slate-100"
            >
              <span>↪</span>
              <span>Sign Out of Session</span>
            </button>

            <p className="mt-2 text-center text-[10px] text-slate-400">
              Does not explicitly unpair this workstation
            </p>
          </div>
        </div>

        {/* UNPAIR */}
        <div className="flex flex-col justify-between rounded-2xl border border-rose-200 bg-white p-6 shadow-xs">
          <div>
            <div className="mb-4 flex items-center justify-between border-b border-rose-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">🔌</span>

                <h2 className="text-base font-bold text-slate-900">
                  Deauthorize &amp; Unpair
                </h2>
              </div>

              <span className="rounded border border-rose-200 bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-800">
                Destructive Action
              </span>
            </div>

            <p className="text-xs leading-relaxed text-slate-600">
              Removes this workstation&apos;s device pairing using
              the configured unpair operation. This action should
              only be used when this computer is being replaced,
              decommissioned, reset, or moved to another shop.
            </p>

            {/* IMPACT */}
            <div className="mt-4 space-y-2 rounded-xl border border-rose-100 bg-rose-50/40 p-3 text-xs text-rose-900">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-rose-700">
                Terminal Impact Checklist
              </span>

              <div className="flex items-start gap-2">
                <span className="font-bold text-rose-600">
                  ✕
                </span>

                <span>
                  <strong>Device pairing is revoked</strong> by the
                  configured unpair operation.
                </span>
              </div>

              <div className="flex items-start gap-2">
                <span className="font-bold text-rose-600">
                  ✕
                </span>

                <span>
                  <strong>Cloud/device association is removed</strong>{" "}
                  according to the backend implementation.
                </span>
              </div>

              <div className="flex items-start gap-2">
                <span className="font-bold text-rose-600">
                  ↻
                </span>

                <span>
                  After successful unpairing, this application
                  navigates to the pairing screen (
                  <code className="font-mono text-[11px]">
                    /pairing
                  </code>
                  ).
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 border-t border-slate-100 pt-4">
            {!confirmUnpair ? (
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setActionError(null);
                    setConfirmUnpair(true);
                  }}
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-rose-700 py-2.5 text-xs font-bold text-white shadow-2xs transition hover:bg-rose-800 active:bg-rose-900"
                >
                  <span>🔒</span>
                  <span>
                    Unpair &amp; Revoke Workstation Credentials
                  </span>
                </button>

                <p className="mt-2 text-center text-[10px] font-medium text-rose-600">
                  Requires dual-step confirmation
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 rounded-xl border border-rose-300 bg-rose-50 p-3.5">
                <p className="text-xs font-bold text-rose-900">
                  Are you absolutely certain? This operation cannot
                  be reversed from this terminal.
                </p>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={unpairing}
                    onClick={() => void handleUnpair()}
                    className="flex-1 cursor-pointer rounded-lg bg-rose-700 py-2 text-xs font-bold text-white transition hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {unpairing
                      ? "Unpairing..."
                      : "Yes, Unpair This PC"}
                  </button>

                  <button
                    type="button"
                    disabled={unpairing}
                    onClick={() => setConfirmUnpair(false)}
                    className="flex-1 cursor-pointer rounded-lg border border-slate-300 bg-white py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/90 bg-white p-4 text-xs text-slate-600 shadow-xs">
        <div className="flex items-center gap-2.5">
          <span className="text-base">ℹ️</span>

          <div>
            <p className="font-bold text-slate-800">
              Need to reconnect this terminal later?
            </p>

            <p className="text-[11px] text-slate-500">
              After successful unpairing, use the pairing flow to
              connect this workstation to a shop again.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/diagnostics"
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white"
          >
            Spooler Diagnostics
          </Link>

          <button
            type="button"
            onClick={() => {
              const electron = getElectronApi();

              if (electron?.ipcRenderer) {
                void electron.ipcRenderer
                  .invoke(
                    "OpenExternal",
                    "https://smartprinter.in/help/pairing"
                  )
                  .catch(() => {
                    window.open(
                      "https://smartprinter.in/help/pairing",
                      "_blank",
                      "noopener,noreferrer"
                    );
                  });
              } else {
                window.open(
                  "https://smartprinter.in/help/pairing",
                  "_blank",
                  "noopener,noreferrer"
                );
              }
            }}
            className="cursor-pointer rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white"
          >
            Help Docs
          </button>
        </div>
      </div>
    </div>
  );
}