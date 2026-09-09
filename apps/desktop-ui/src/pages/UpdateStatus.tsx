import { useEffect, useState } from "react";

export default function UpdateStatus() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    window.smartprinter.onUpdateDownloaded(() => setUpdateReady(true));
  }, []);

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-xl font-semibold text-brand-900">App updates</h1>
      <p className="mb-6 text-sm text-brand-500">SmartPrinter Desktop checks for updates automatically.</p>

      <div className="card">
        {updateReady ? (
          <>
            <p className="mb-4 text-sm text-brand-700">
              An update has been downloaded and is ready to install. Restart the app to apply it.
            </p>
            <button className="btn-primary w-full" onClick={() => window.location.reload()}>
              Restart now
            </button>
          </>
        ) : (
          <p className="text-sm text-brand-500">You're on the latest version. We'll notify you here when an update is ready.</p>
        )}
      </div>
    </div>
  );
}
