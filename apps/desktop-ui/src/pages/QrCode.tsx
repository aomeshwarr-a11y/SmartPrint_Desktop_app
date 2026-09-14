import { useEffect, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

export default function QrCode() {
  const { session } = useAuth();

  const [shopUrl, setShopUrl] = useState<string | null>(null);
  const [shopName, setShopName] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    async function load() {
      if (!session) {
        setLoading(false);
        return;
      }

      try {
        let branchData: { id: string; name: string | null } | null = null;

        // 1. Check branches where user is owner or manager
        const { data: ownedBranch } = await supabase
          .from("branches")
          .select("id, name")
          .or(`owner_id.eq.${session.user.id},manager_id.eq.${session.user.id}`)
          .limit(1)
          .maybeSingle();

        if (ownedBranch) {
          branchData = ownedBranch;
        } else {
          // 2. Check user_roles table for branch membership
          const { data: roleRow } = await supabase
            .from("user_roles")
            .select("branch_id, branches(id, name)")
            .eq("user_id", session.user.id)
            .in("role", ["branch", "branch_owner", "shop_owner"])
            .limit(1)
            .maybeSingle();

          if (roleRow) {
            const b = (roleRow as any)?.branches;
            if (b?.id) {
              branchData = { id: b.id, name: b.name ?? null };
            } else if (roleRow.branch_id) {
              branchData = { id: roleRow.branch_id, name: null };
            }
          }
        }

        if (branchData?.id) {
          // Customer URL encoded into the QR resolves by branch ID
          const publicUrl = `https://smartprinter.in/s/${branchData.id}`;

          setShopUrl(publicUrl);
          setShopName(branchData.name ?? "");
        }
      } catch (err) {
        console.error("Unexpected error fetching branch QR:", err);
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [session]);

  function printQr() {
    window.print();
  }

  async function handleCopy() {
    if (!shopUrl) return;

    try {
      await navigator.clipboard.writeText(shopUrl);
      setCopied(true);

      window.setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (error) {
      console.error("Failed to copy shop URL:", error);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#faf8ff] p-6 lg:p-8 text-slate-800 select-none">
      {/* 1. HEADER */}
      <div className="mx-auto max-w-2xl mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 mb-1">
              <span>Supabase: branches table</span>
              <span>/</span>
              <span className="font-mono">QrCode.tsx</span>

              {shopUrl && (
                <>
                  <span>/</span>
                  <span className="font-mono text-emerald-700">
                    id: {shopUrl.split("/").pop()}
                  </span>
                </>
              )}
            </div>

            <h1 className="text-xl font-bold tracking-tight text-slate-900 lg:text-2xl">
              Your shop QR code
            </h1>

            <p className="mt-1 text-xs text-slate-500">
              Print this and place it where customers can scan it. The QR only
              contains a public link — no secrets.
            </p>
          </div>

          {shopUrl && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 active:bg-slate-100 transition"
              >
                {copied ? "✓ Copied!" : "📋 Copy link"}
              </button>

              <button
                type="button"
                onClick={printQr}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-emerald-700 active:bg-emerald-800 transition"
              >
                🖨️ Print QR code
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 2. CARD CONTENT */}
      <div className="mx-auto max-w-md">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-xs text-slate-400 shadow-xs">
            <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent mb-3" />

            <p>Loading shop QR code from Supabase...</p>
          </div>
        ) : shopUrl ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 text-center shadow-xs">
            {/* Shop Brand Header */}
            <div className="mb-4">
              <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white font-bold shadow-2xs">
                🖨️
              </div>

              <h2 className="text-base font-bold text-slate-900">
                {shopName || "My Print Shop"}
              </h2>

              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                Self-Serve Printing
              </p>
            </div>

            <div className="mb-5">
              <h3 className="text-lg font-bold text-slate-900">
                Scan to print documents
              </h3>

              <p className="mt-0.5 text-xs text-slate-500">
                Open camera, scan this code, and upload your files directly to
                this shop&apos;s print queue.
              </p>
            </div>

            {/* QR CODE GENERATION */}
            <div className="my-5 inline-flex justify-center rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm">
              <QRCodeCanvas
                value={shopUrl}
                size={220}
                includeMargin
                level="H"
              />
            </div>

            {/* Public Link Display */}
            <div className="mt-2 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">
                Public Link
              </p>

              <p className="break-all font-mono text-xs font-semibold text-slate-800 select-all">
                {shopUrl}
              </p>
            </div>

            {/* Primary Action Button */}
            <button
              type="button"
              onClick={printQr}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 active:bg-emerald-800 transition cursor-pointer"
            >
              <span>🖨️</span>
              <span>Print QR code</span>
            </button>

            <p className="mt-4 text-[11px] text-slate-400">
              📱 Works in any phone browser • No app needed
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-xs">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600 text-lg">
              ℹ️
            </div>

            <p className="text-sm font-bold text-slate-800">
              Shop setup required
            </p>

            <p className="mt-1 text-xs text-slate-500">
              Finish shop setup first to generate your QR code.
            </p>
          </div>
        )}

        {/* 3. WALK-IN CUSTOMER EXPLANATION BANNER */}
        <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600 shadow-2xs">
          <div className="flex items-start gap-2.5">
            <span className="text-base text-emerald-600">ℹ️</span>

            <div>
              <p className="font-bold text-slate-800">
                How walk-in customers print
              </p>

              <p className="mt-0.5 text-slate-500 leading-relaxed">
                Customers scan this QR code with their phone camera to
                instantly upload PDFs or images without downloading any app.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}