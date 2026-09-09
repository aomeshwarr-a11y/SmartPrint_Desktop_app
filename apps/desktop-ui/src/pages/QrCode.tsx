import { useEffect, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

export default function QrCode() {
  const { session } = useAuth();
  const [shopUrl, setShopUrl] = useState<string | null>(null);
  const [shopName, setShopName] = useState<string>("");

  useEffect(() => {
    async function load() {
      if (!session) return;
      const { data } = await supabase.from("shops").select("name, slug").eq("owner_user_id", session.user.id).maybeSingle();
      if (data?.slug) {
        setShopUrl(`https://smartprinter.in/s/${data.slug}`);
        setShopName(data.name ?? "");
      }
    }
    void load();
  }, [session]);

  function printQr() {
    window.print();
  }

  return (
    <div className="mx-auto max-w-md text-center">
      <h1 className="mb-1 text-xl font-semibold text-brand-900">Your shop QR code</h1>
      <p className="mb-6 text-sm text-brand-500">
        Print this and place it where customers can scan it. The QR only contains a public link - no secrets.
      </p>

      <div className="card">
        {shopUrl ? (
          <>
            <div className="flex justify-center rounded-lg bg-white p-6">
              <QRCodeCanvas value={shopUrl} size={220} includeMargin />
            </div>
            <p className="mt-4 font-medium text-brand-900">{shopName}</p>
            <p className="break-all text-xs text-brand-500">{shopUrl}</p>
            <button className="btn-primary mt-6 w-full" onClick={printQr}>
              Print QR code
            </button>
          </>
        ) : (
          <p className="text-sm text-brand-500">Finish shop setup first to generate your QR code.</p>
        )}
      </div>
    </div>
  );
}
