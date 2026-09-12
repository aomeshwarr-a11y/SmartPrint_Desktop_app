import { useState, useRef, useEffect, type FormEvent, type ChangeEvent, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";

export default function ShopSetup() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form State
  const [shopName, setShopName] = useState("My Print Shop");
  const [shopAddress, setShopAddress] = useState("123 Main St, Bengaluru, Karnataka, 560001");
  const [slug, setSlug] = useState("my-print-shop");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load existing shop and branch if already configured in Supabase
  useEffect(() => {
    async function loadExistingShop() {
      if (!isSupabaseConfigured || !session?.user) return;
      try {
        const { data: shop } = await supabase
          .from("shops")
          .select("id, name, slug")
          .eq("owner_user_id", session.user.id)
          .maybeSingle();

        if (shop) {
          if (shop.name) setShopName(shop.name);
          if (shop.slug) setSlug(shop.slug);

          const { data: branch } = await supabase
            .from("branches")
            .select("address")
            .eq("shop_id", shop.id)
            .maybeSingle();

          if (branch?.address) {
            setShopAddress(branch.address);
          }
        }
      } catch (err) {
        console.warn("Could not prefetch shop details:", err);
      }
    }
    void loadExistingShop();
  }, [session]);

  // Slug generator helper
  function handleNameChange(e: ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setShopName(val);
    const autoSlug = val
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-");
    setSlug(autoSlug || "my-shop");
  }

  // File upload handling
  function handleFileSelected(file: File) {
    if (!file.type.startsWith("image/")) {
      setErrorMessage("Please select a valid image file (JPG or PNG).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrorMessage("Photo size must be less than 5 MB.");
      return;
    }
    setErrorMessage(null);
    const objectUrl = URL.createObjectURL(file);
    setPhotoPreview(objectUrl);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);

    try {
      if (isSupabaseConfigured && session?.user) {
        // 1. Upsert shops table (schema: id, owner_user_id, name, slug, status)
        const { data: existingShop } = await supabase
          .from("shops")
          .select("id")
          .eq("owner_user_id", session.user.id)
          .maybeSingle();

        let shopId = existingShop?.id;
        if (shopId) {
          const { error: updateError } = await supabase
            .from("shops")
            .update({ name: shopName, slug })
            .eq("id", shopId);
          if (updateError) throw updateError;
        } else {
          const { data: newShop, error: insertError } = await supabase
            .from("shops")
            .insert({
              owner_user_id: session.user.id,
              name: shopName,
              slug,
              status: "active",
            })
            .select("id")
            .single();
          if (insertError) throw insertError;
          shopId = newShop.id;
        }

        // 2. Upsert branches table (schema: id, shop_id, address, timezone)
        if (shopId) {
          const { data: existingBranch } = await supabase
            .from("branches")
            .select("id")
            .eq("shop_id", shopId)
            .maybeSingle();

          if (existingBranch) {
            await supabase
              .from("branches")
              .update({ address: shopAddress })
              .eq("id", existingBranch.id);
          } else {
            await supabase.from("branches").insert({
              shop_id: shopId,
              address: shopAddress,
              timezone: "Asia/Kolkata",
            });
          }

          // 3. Upsert qr_codes table (schema: id, shop_id, slug, active)
          const { data: existingQr } = await supabase
            .from("qr_codes")
            .select("id")
            .eq("shop_id", shopId)
            .maybeSingle();

          if (existingQr) {
            await supabase
              .from("qr_codes")
              .update({ slug, active: true })
              .eq("id", existingQr.id);
          } else {
            await supabase.from("qr_codes").insert({
              shop_id: shopId,
              slug,
              active: true,
            });
          }
        }
      }

      // Navigate to the next onboarding step (Device Pairing)
      navigate("/pairing");
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to save shop profile. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen w-screen flex-col bg-white font-sans text-slate-800 antialiased select-none overflow-x-hidden">
      {/* 1. TOP HEADER */}
      <header className="flex h-16 w-full items-center justify-between border-b border-slate-100 px-8 lg:px-12 bg-white shrink-0">
        {/* Logo & Title */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0284c7] text-white shadow-xs">
            <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
              <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z" />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-900">SmartPrinter</span>
        </div>

        {/* Live Status */}
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Online</span>
        </div>
      </header>

      {/* 2. PROGRESS STEP BAR */}
      <div className="w-full border-b border-slate-100 bg-white px-8 lg:px-12 py-3.5">
        <div className="mx-auto max-w-6xl">
          <div className="text-xs font-semibold text-slate-500 mb-1.5">
            1 of 2 • Shop setup
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full w-1/2 rounded-full bg-[#0284c7] transition-all duration-300" />
          </div>
        </div>
      </div>

      {/* 3. MAIN CONTENT CONTAINER */}
      <main className="flex-1 px-8 lg:px-12 py-8 bg-white">
        <div className="mx-auto max-w-6xl">
          {/* Page Title & Subtitle */}
          <div className="mb-8">
            <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-slate-900">
              Set up your shop
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Tell us about your print shop and help customers recognize you.
            </p>
          </div>

          {errorMessage && (
            <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-700">
              {errorMessage}
            </div>
          )}

          {/* TWO COLUMN GRID */}
          <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            {/* LEFT COLUMN: SETUP FORM */}
            <div className="lg:col-span-6 space-y-6">
              <div className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                LEFT COLUMN
              </div>

              {/* Shop Name Input */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Shop name
                </label>
                <input
                  type="text"
                  required
                  value={shopName}
                  onChange={handleNameChange}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-[#0284c7] focus:outline-none focus:ring-1 focus:ring-[#0284c7] transition shadow-2xs"
                  placeholder="e.g. Apex Print & Xerox"
                />
              </div>

              {/* Shop Address Input */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Shop address
                </label>
                <input
                  type="text"
                  required
                  value={shopAddress}
                  onChange={(e) => setShopAddress(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-[#0284c7] focus:outline-none focus:ring-1 focus:ring-[#0284c7] transition shadow-2xs"
                  placeholder="Street, City, State, Pincode"
                />
              </div>

              {/* Public URL Slug */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Public URL slug
                </label>
                <div className="flex rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden focus-within:border-[#0284c7] focus-within:ring-1 focus-within:ring-[#0284c7] transition">
                  <span className="flex items-center bg-slate-50 px-3.5 text-xs text-slate-500 font-mono border-r border-slate-200 select-none">
                    smartprinter.in/s/
                  </span>
                  <input
                    type="text"
                    required
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    className="flex-1 px-3.5 py-2.5 text-xs font-mono text-slate-900 placeholder-slate-400 bg-white focus:outline-none"
                    placeholder="my-shop"
                  />
                </div>
              </div>

              {/* Shop Photo Upload Card */}
              <div>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 transition text-center ${
                    isDragging
                      ? "border-[#0284c7] bg-sky-50/50"
                      : "border-sky-200 bg-sky-50/20 hover:bg-sky-50/40"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileSelected(e.target.files[0]);
                      }
                    }}
                  />

                  {/* Drag & Drop Support Badge */}
                  <span className="absolute top-3.5 right-4 text-[10px] font-medium text-slate-400">
                    Drag &amp; drop support
                  </span>

                  {photoPreview ? (
                    <div className="flex flex-col items-center">
                      <img
                        src={photoPreview}
                        alt="Shop Preview"
                        className="h-20 w-20 rounded-xl object-cover border border-slate-200 shadow-sm mb-3"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50"
                      >
                        Change photo
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Camera Icon */}
                      <div className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-[#0284c7]">
                        <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                          <path d="M4 4h3l2-2h6l2 2h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm8 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" />
                        </svg>
                      </div>
                      <p className="text-xs font-bold text-slate-900">Add your shop photo</p>
                      <p className="text-[11px] text-slate-500 mt-0.5 mb-3">
                        Help customers recognize your shop
                      </p>

                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition cursor-pointer"
                      >
                        Upload shop photo
                      </button>
                      <span className="text-[10px] text-slate-400 mt-2">JPG, PNG • Up to 5 MB</span>
                    </>
                  )}
                </div>
              </div>

              {/* Action Button & Disclaimer */}
              <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-4">
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-xl bg-[#0284c7] px-6 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#0369a1] active:scale-[0.99] transition cursor-pointer disabled:opacity-50"
                >
                  {submitting ? "Saving..." : "Save and continue"}
                </button>
                <p className="text-xs text-slate-500 leading-tight">
                  Your shop profile will be visible to customers on your{" "}
                  <span className="font-semibold text-slate-700">SmartPrinter page</span>.
                </p>
              </div>
            </div>

            {/* RIGHT COLUMN: KIOSK HARDWARE / GRAPHIC PREVIEW */}
            <div className="lg:col-span-6 space-y-6">
              <div className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                RIGHT COLUMN
              </div>

              <div className="flex items-center justify-center rounded-3xl border border-slate-100 bg-[#f8fafc] p-6 lg:p-10 shadow-inner">
                {/* SVG RENDERING OF SMARTPRINTER TOTEM / KIOSK */}
                <svg
                  className="w-full max-w-[340px] drop-shadow-xl"
                  viewBox="0 0 340 440"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  {/* Kiosk Main Pillar Body */}
                  <path
                    d="M 60 120 L 110 50 L 230 50 L 280 120 L 280 400 L 60 400 Z"
                    fill="#059669"
                  />
                  {/* Darker green side bevel */}
                  <path
                    d="M 230 50 L 280 120 L 280 400 L 260 400 L 260 130 L 220 70 Z"
                    fill="#047857"
                  />

                  {/* Kiosk Faceplate (White Cardboard Area) */}
                  <rect
                    x="80"
                    y="130"
                    width="180"
                    height="240"
                    rx="12"
                    fill="#ffffff"
                    stroke="#e2e8f0"
                    strokeWidth="1.5"
                  />

                  {/* Top Header on Totem */}
                  <rect x="110" y="65" width="120" height="20" rx="4" fill="#047857" />
                  <text
                    x="170"
                    y="79"
                    fill="#ffffff"
                    fontSize="8"
                    fontWeight="bold"
                    textAnchor="middle"
                    letterSpacing="1"
                  >
                    COLLECT PRINT HERE
                  </text>

                  {/* SmartPrinter Logo on Totem */}
                  <text
                    x="170"
                    y="155"
                    fill="#0284c7"
                    fontSize="13"
                    fontWeight="900"
                    textAnchor="middle"
                    letterSpacing="0.5"
                  >
                    SMARTPRINTER
                  </text>
                  <text
                    x="170"
                    y="167"
                    fill="#64748b"
                    fontSize="7"
                    fontWeight="bold"
                    textAnchor="middle"
                    letterSpacing="1.5"
                  >
                    SCAN QR TO PRINT
                  </text>

                  {/* QR Code Container */}
                  <rect
                    x="120"
                    y="178"
                    width="100"
                    height="100"
                    rx="8"
                    fill="#f8fafc"
                    stroke="#cbd5e1"
                    strokeWidth="1"
                  />
                  {/* QR Code Matrix Details */}
                  <rect x="130" y="188" width="24" height="24" fill="#0f172a" rx="3" />
                  <rect x="134" y="192" width="16" height="16" fill="#f8fafc" rx="2" />
                  <rect x="138" y="196" width="8" height="8" fill="#0f172a" rx="1" />

                  <rect x="186" y="188" width="24" height="24" fill="#0f172a" rx="3" />
                  <rect x="190" y="192" width="16" height="16" fill="#f8fafc" rx="2" />
                  <rect x="194" y="196" width="8" height="8" fill="#0f172a" rx="1" />

                  <rect x="130" y="244" width="24" height="24" fill="#0f172a" rx="3" />
                  <rect x="134" y="248" width="16" height="16" fill="#f8fafc" rx="2" />
                  <rect x="138" y="252" width="8" height="8" fill="#0f172a" rx="1" />

                  {/* QR code interior noise */}
                  <rect x="160" y="192" width="6" height="6" fill="#0f172a" />
                  <rect x="170" y="202" width="8" height="6" fill="#0f172a" />
                  <rect x="164" y="218" width="12" height="12" fill="#0f172a" />
                  <rect x="186" y="236" width="6" height="6" fill="#0f172a" />
                  <rect x="196" y="246" width="10" height="8" fill="#0f172a" />
                  <rect x="176" y="258" width="6" height="6" fill="#0f172a" />

                  {/* Feature Icons (Upload, Pay, Print) */}
                  <text x="110" y="292" fill="#64748b" fontSize="7" fontWeight="bold">
                    ☁ Upload
                  </text>
                  <text x="160" y="292" fill="#64748b" fontSize="7" fontWeight="bold">
                    ₹ Pay
                  </text>
                  <text x="202" y="292" fill="#64748b" fontSize="7" fontWeight="bold">
                    🖨 Print
                  </text>

                  {/* Bottom Mascot / Illustration Graphics */}
                  <circle cx="130" cy="335" r="18" fill="#e0f2fe" stroke="#0284c7" strokeWidth="1.5" />
                  <circle cx="126" cy="333" r="2.5" fill="#0284c7" />
                  <circle cx="134" cy="333" r="2.5" fill="#0284c7" />
                  <path d="M 126 339 Q 130 343 134 339" stroke="#0284c7" strokeWidth="1.5" fill="none" />
                  <rect x="122" y="353" width="16" height="14" rx="4" fill="#0284c7" />

                  <text x="156" y="335" fill="#047857" fontSize="8" fontWeight="bold">
                    SMART PRINTING
                  </text>
                  <text x="156" y="345" fill="#0f172a" fontSize="7" fontWeight="bold">
                    SMARTER GENERATION
                  </text>

                  {/* Kiosk Side Access Port */}
                  <rect x="264" y="160" width="12" height="28" rx="3" fill="#022c22" />

                  {/* Base Feet */}
                  <rect x="75" y="400" width="20" height="8" rx="2" fill="#334155" />
                  <rect x="245" y="400" width="20" height="8" rx="2" fill="#334155" />
                </svg>
              </div>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}