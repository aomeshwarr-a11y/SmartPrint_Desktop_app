import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { pairDeviceConfirm, pairDeviceCreate } from "../lib/ipc";

export default function DevicePairing() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  async function requestPairingCode() {
    if (!session) return;
    setRequesting(true);
    setError(null);
    try {
      const result = await pairDeviceCreate({ ownerAccessToken: session.access_token });
      setPairingCode(result.pairingCode);
      setExpiresAt(result.expiresAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start pairing.");
    } finally {
      setRequesting(false);
    }
  }

  async function confirmPairing() {
    if (!pairingCode) return;
    setConfirming(true);
    setError(null);
    try {
      await pairDeviceConfirm({ pairingCode });
      navigate("/printers");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pairing was not confirmed. Try again.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-xl font-semibold text-brand-900">Pair this computer</h1>
      <p className="mb-6 text-sm text-brand-500">
        This links the SmartPrinter agent running on this PC to your shop account.
      </p>

      <div className="card">
        {!pairingCode ? (
          <>
            <p className="mb-4 text-sm text-brand-600">
              Click below to generate a pairing code for this computer. You will confirm it in the next step.
            </p>
            <button className="btn-primary w-full" disabled={requesting} onClick={requestPairingCode}>
              {requesting ? "Requesting..." : "Generate pairing code"}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-brand-500">Pairing code for this computer</p>
            <p className="my-4 text-center text-4xl font-mono font-semibold tracking-widest text-brand-900">
              {pairingCode}
            </p>
            {expiresAt && (
              <p className="mb-4 text-center text-xs text-brand-500">Expires {new Date(expiresAt).toLocaleTimeString()}</p>
            )}
            <button className="btn-primary w-full" disabled={confirming} onClick={confirmPairing}>
              {confirming ? "Confirming..." : "Confirm pairing"}
            </button>
          </>
        )}

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
