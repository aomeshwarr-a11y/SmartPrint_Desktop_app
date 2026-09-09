import { useEffect, useState } from "react";
import { getSettings, updateSettings } from "../lib/ipc";

export default function Settings() {
  const [settings, setSettings] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      setSettings(await getSettings());
      setLoading(false);
    }
    void load();
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const updated = await updateSettings({ settings });
      setSettings(updated);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-brand-500">Loading settings...</p>;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-xl font-semibold text-brand-900">Settings</h1>
      <p className="mb-6 text-sm text-brand-500">These apply to the background agent running on this computer.</p>

      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-brand-900">Start automatically with Windows</p>
            <p className="text-xs text-brand-500">Recommended - keeps printing even if nobody logs in.</p>
          </div>
          <input
            type="checkbox"
            checked={settings.auto_start === "true"}
            onChange={(e) => setSettings({ ...settings, auto_start: e.target.checked ? "true" : "false" })}
            className="h-5 w-5"
          />
        </div>

        <div>
          <label className="label" htmlFor="logLevel">
            Log verbosity
          </label>
          <select
            id="logLevel"
            className="input"
            value={settings.log_verbosity ?? "Information"}
            onChange={(e) => setSettings({ ...settings, log_verbosity: e.target.value })}
          >
            <option value="Debug">Debug</option>
            <option value="Information">Information</option>
            <option value="Warning">Warning</option>
            <option value="Error">Error</option>
          </select>
        </div>

        <button className="btn-primary w-full" disabled={saving} onClick={save}>
          {saving ? "Saving..." : "Save settings"}
        </button>
        {saved && <p className="text-center text-sm text-brand-600">Saved.</p>}
      </div>
    </div>
  );
}
