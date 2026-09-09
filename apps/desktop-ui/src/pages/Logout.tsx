import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { unpairDevice } from "../lib/ipc";

export default function Logout() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [unpairing, setUnpairing] = useState(false);
  const [confirmUnpair, setConfirmUnpair] = useState(false);

  async function handleSignOut() {
    await signOut();
    navigate("/");
  }

  async function handleUnpair() {
    setUnpairing(true);
    try {
      await unpairDevice();
      navigate("/pairing");
    } finally {
      setUnpairing(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="card">
        <h2 className="mb-2 text-lg font-semibold text-brand-900">Log out</h2>
        <p className="mb-4 text-sm text-brand-500">
          Signs you out of this owner account. The background agent keeps printing paired jobs.
        </p>
        <button className="btn-secondary w-full" onClick={handleSignOut}>
          Log out
        </button>
      </div>

      <div className="card border-red-200">
        <h2 className="mb-2 text-lg font-semibold text-red-700">Unpair this computer</h2>
        <p className="mb-4 text-sm text-brand-500">
          Revokes this computer's device credentials. New jobs will stop arriving until you pair again. Do this if
          you are retiring this PC or moving to a new one.
        </p>
        {!confirmUnpair ? (
          <button className="btn-secondary w-full border-red-300 text-red-700" onClick={() => setConfirmUnpair(true)}>
            Unpair this computer
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium text-red-700">Are you sure? This cannot be undone from this screen.</p>
            <button className="btn-primary w-full bg-red-600 hover:bg-red-700" disabled={unpairing} onClick={handleUnpair}>
              {unpairing ? "Unpairing..." : "Yes, unpair this computer"}
            </button>
            <button className="btn-secondary w-full" onClick={() => setConfirmUnpair(false)}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
