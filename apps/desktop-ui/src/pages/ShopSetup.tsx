import {
  useState,
  useRef,
  useEffect,
  type FormEvent,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  supabase,
  isSupabaseConfigured,
} from "../lib/supabaseClient";

export default function ShopSetup() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ============================================================
  // FORM STATE
  // ============================================================

  const [shopName, setShopName] = useState("");
  const [shopAddress, setShopAddress] = useState("");
  const [slug, setSlug] = useState("");

  const [photoPreview, setPhotoPreview] = useState<string | null>(
    null
  );

  const [isDragging, setIsDragging] = useState(false);
  const [loadingBranch, setLoadingBranch] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(
    null
  );

  const [existingBranchId, setExistingBranchId] = useState<
    string | null
  >(null);

  // ============================================================
  // LOAD EXISTING BRANCH
  // ============================================================

  useEffect(() => {
    let mounted = true;

    async function loadExistingBranch() {
      if (!isSupabaseConfigured || !session?.user) {
        if (mounted) {
          setLoadingBranch(false);
        }
        return;
      }

      try {
        setLoadingBranch(true);
        setErrorMessage(null);

        // --------------------------------------------------------
        // 1. Check direct ownership / management
        // --------------------------------------------------------

        const {
          data: ownedBranch,
          error: ownedBranchError,
        } = await supabase
          .from("branches")
          .select("id, name, location")
          .or(
            `owner_id.eq.${session.user.id},manager_id.eq.${session.user.id}`
          )
          .limit(1)
          .maybeSingle();

        if (ownedBranchError) {
          console.warn(
            "Direct branch lookup failed:",
            ownedBranchError
          );
        }

        if (ownedBranch && mounted) {
          setExistingBranchId(ownedBranch.id);
          setShopName(ownedBranch.name ?? "");
          setShopAddress(ownedBranch.location ?? "");

          // UI-only slug.
          setSlug(createSlug(ownedBranch.name ?? ""));

          return;
        }

        // --------------------------------------------------------
        // 2. Check branch membership through user_roles
        // --------------------------------------------------------

        const {
          data: roleRow,
          error: roleError,
        } = await supabase
          .from("user_roles")
          .select("branch_id")
          .eq("user_id", session.user.id)
          .in("role", ["branch", "branch_owner", "shop_owner"])
          .not("branch_id", "is", null)
          .limit(1)
          .maybeSingle();

        if (roleError) {
          console.warn(
            "Branch role lookup failed:",
            roleError
          );
        }

        if (roleRow?.branch_id && mounted) {
          const branchId = roleRow.branch_id;

          const {
            data: roleBranch,
            error: roleBranchError,
          } = await supabase
            .from("branches")
            .select("id, name, location")
            .eq("id", branchId)
            .maybeSingle();

          if (roleBranchError) {
            console.warn(
              "Branch details lookup failed:",
              roleBranchError
            );
          } else if (roleBranch) {
            setExistingBranchId(roleBranch.id);
            setShopName(roleBranch.name ?? "");
            setShopAddress(roleBranch.location ?? "");

            // UI-only slug because branches.slug does not exist in production.
            setSlug(createSlug(roleBranch.name ?? ""));
          }
        }
      } catch (error) {
        console.warn(
          "Could not load existing branch:",
          error
        );
      } finally {
        if (mounted) {
          setLoadingBranch(false);
        }
      }
    }

    void loadExistingBranch();

    return () => {
      mounted = false;
    };
  }, [session]);

  // ============================================================
  // SLUG HELPERS
  // ============================================================

  function createSlug(value: string) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function handleNameChange(
    e: ChangeEvent<HTMLInputElement>
  ) {
    const value = e.target.value;

    setShopName(value);

    // Slug is only a UI field for now because
    // branches.slug does not exist in production.
    setSlug(createSlug(value) || "my-shop");
  }

  function handleSlugChange(
    e: ChangeEvent<HTMLInputElement>
  ) {
    const value = e.target.value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-/, "");

    setSlug(value);
  }

  // ============================================================
  // PHOTO HANDLING
  // ============================================================

  function handleFileSelected(file: File) {
    setErrorMessage(null);

    if (!file.type.startsWith("image/")) {
      setErrorMessage(
        "Please select a valid image file (JPG or PNG)."
      );
      return;
    }

    if (
      file.type !== "image/jpeg" &&
      file.type !== "image/png"
    ) {
      setErrorMessage(
        "Only JPG and PNG images are supported."
      );
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrorMessage(
        "Photo size must be less than 5 MB."
      );
      return;
    }

    const objectUrl = URL.createObjectURL(file);

    setPhotoPreview((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }

      return objectUrl;
    });
  }

  function handleFileInputChange(
    e: ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];

    if (file) {
      handleFileSelected(file);
    }
  }

  function handleDrop(
    e: DragEvent<HTMLDivElement>
  ) {
    e.preventDefault();
    e.stopPropagation();

    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];

    if (file) {
      handleFileSelected(file);
    }
  }

  function handleDragOver(
    e: DragEvent<HTMLDivElement>
  ) {
    e.preventDefault();
    e.stopPropagation();

    setIsDragging(true);
  }

  function handleDragLeave(
    e: DragEvent<HTMLDivElement>
  ) {
    e.preventDefault();
    e.stopPropagation();

    setIsDragging(false);
  }

  // ============================================================
  // CLEANUP PHOTO URL
  // ============================================================

  useEffect(() => {
    return () => {
      if (photoPreview) {
        URL.revokeObjectURL(photoPreview);
      }
    };
  }, [photoPreview]);

  // ============================================================
  // VALIDATION
  // ============================================================

  function validateForm() {
    const trimmedName = shopName.trim();
    const trimmedAddress = shopAddress.trim();

    if (!trimmedName) {
      return "Please enter your shop name.";
    }

    if (trimmedName.length < 2) {
      return "Shop name must contain at least 2 characters.";
    }

    if (!trimmedAddress) {
      return "Please enter your shop address.";
    }

    return null;
  }

  // ============================================================
  // SAVE SHOP / BRANCH
  // ============================================================

  async function handleSubmit(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    if (submitting) {
      return;
    }

    setErrorMessage(null);

    const validationError = validateForm();

    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    if (!isSupabaseConfigured) {
      setErrorMessage(
        "Supabase is not configured. Please check the desktop application configuration."
      );
      return;
    }

    if (!session?.user) {
      setErrorMessage(
        "Your session has expired. Please log in again."
      );
      return;
    }

    const userId = session.user.id;

    setSubmitting(true);

    try {
      const name = shopName.trim();
      const location = shopAddress.trim();

      // ========================================================
      // EXISTING BRANCH
      // ========================================================

      if (existingBranchId) {
        const {
          error: updateError,
        } = await supabase
          .from("branches")
          .update({
            name,
            location,
          })
          .eq("id", existingBranchId);

        if (updateError) {
          throw updateError;
        }
      }

      // ========================================================
      // NEW BRANCH
      // ========================================================

      else {
        const {
          data: newBranch,
          error: insertError,
        } = await supabase
          .from("branches")
          .insert({
            owner_id: userId,
            name,
            location,
          })
          .select("id")
          .single();

        if (insertError) {
          throw insertError;
        }

        if (!newBranch?.id) {
          throw new Error(
            "Shop was saved but the branch ID could not be retrieved."
          );
        }

        setExistingBranchId(newBranch.id);
      }

      // ========================================================
      // SUCCESS
      // ========================================================

      navigate("/pairing", {
        replace: true,
      });
    } catch (error: unknown) {
      console.error(
        "Failed to save shop setup:",
        error
      );

      const message =
        error instanceof Error
          ? error.message
          : "Failed to save shop profile. Please try again.";

      const lowerMessage = message.toLowerCase();

      if (
        lowerMessage.includes("row-level security") ||
        lowerMessage.includes("rls")
      ) {
        setErrorMessage(
          "Your account is not authorized to create this shop yet. Please make sure your shop-owner account is configured."
        );
      } else if (
        lowerMessage.includes("duplicate") ||
        lowerMessage.includes("unique")
      ) {
        setErrorMessage(
          "This shop information already exists. Please check the details and try again."
        );
      } else {
        setErrorMessage(message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ============================================================
  // UI
  // ============================================================

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-white font-sans text-slate-800 antialiased select-none">

      {/* ========================================================
          HEADER
      ======================================================== */}

      <header className="flex h-12 w-full shrink-0 items-center justify-between border-b border-slate-100 bg-white px-8 lg:px-12">

        <div className="flex items-center gap-2.5">

          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#059669] text-white shadow-sm">
            <svg
              className="h-4 w-4 fill-current"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z" />
            </svg>
          </div>

          <span className="text-lg font-bold tracking-tight text-slate-900">
            SmartPrinter
          </span>

        </div>

        <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
          <span>Online</span>
        </div>

      </header>

      {/* ========================================================
          PROGRESS
      ======================================================== */}

      <div className="h-11 w-full shrink-0 border-b border-slate-100 bg-white px-8 py-2 lg:px-12">

        <div className="mx-auto flex h-full min-h-0 max-w-6xl flex-col">

          <div className="mb-1.5 text-xs font-semibold text-slate-500">
            1 of 2 • Shop setup
          </div>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full w-1/2 rounded-full bg-[#059669] transition-all duration-300" />
          </div>

        </div>

      </div>

      {/* ========================================================
          MAIN
      ======================================================== */}

      <main className="min-h-0 flex-1 overflow-hidden bg-white px-8 py-3 lg:px-12">

        <div className="mx-auto flex h-full min-h-0 max-w-6xl flex-col">

          {/* TITLE */}

          <div className="mb-3 shrink-0">

            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 lg:text-3xl">
              Set up your shop
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              Tell us about your print shop and help customers
              recognize you.
            </p>

          </div>

          {/* ERROR */}

          {errorMessage && (
            <div
              role="alert"
              className="mb-3 shrink-0 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700"
            >
              {errorMessage}
            </div>
          )}

          {/* LOADING */}

          {loadingBranch ? (
            <div className="flex min-h-0 flex-1 items-center justify-center">

              <div className="flex flex-col items-center gap-3">

                <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-100 border-t-[#059669]" />

                <p className="text-xs font-medium text-slate-500">
                  Loading your shop profile...
                </p>

              </div>

            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="grid min-h-0 flex-1 grid-cols-1 items-stretch gap-6 lg:grid-cols-12"
            >

              {/* ==================================================
                  LEFT COLUMN
              ================================================== */}

              <div className="flex min-h-0 flex-col gap-3 lg:col-span-6">

                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  SHOP DETAILS
                </div>

                {/* SHOP NAME */}

                <div>

                  <label
                    htmlFor="shop-name"
                    className="mb-1.5 block text-xs font-semibold text-slate-700"
                  >
                    Shop name
                  </label>

                  <input
                    id="shop-name"
                    type="text"
                    required
                    maxLength={100}
                    value={shopName}
                    onChange={handleNameChange}
                    disabled={submitting}
                    autoComplete="organization"
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#059669] focus:ring-1 focus:ring-[#059669] disabled:cursor-not-allowed disabled:bg-slate-50"
                    placeholder="e.g. Apex Print & Xerox"
                  />

                </div>

                {/* ADDRESS */}

                <div>

                  <label
                    htmlFor="shop-address"
                    className="mb-1.5 block text-xs font-semibold text-slate-700"
                  >
                    Shop address
                  </label>

                  <input
                    id="shop-address"
                    type="text"
                    required
                    maxLength={250}
                    value={shopAddress}
                    onChange={(e) =>
                      setShopAddress(e.target.value)
                    }
                    disabled={submitting}
                    autoComplete="street-address"
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#059669] focus:ring-1 focus:ring-[#059669] disabled:cursor-not-allowed disabled:bg-slate-50"
                    placeholder="Street, City, State, Pincode"
                  />

                </div>

                {/* PUBLIC URL */}

                <div>

                  <label
                    htmlFor="shop-slug"
                    className="mb-1.5 block text-xs font-semibold text-slate-700"
                  >
                    Public URL slug
                  </label>

                  <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition focus-within:border-[#059669] focus-within:ring-1 focus-within:ring-[#059669]">

                    <span className="flex shrink-0 items-center border-r border-slate-200 bg-slate-50 px-3.5 font-mono text-xs text-slate-500">
                      smartprinter.in/s/
                    </span>

                    <input
                      id="shop-slug"
                      type="text"
                      maxLength={80}
                      value={slug}
                      onChange={handleSlugChange}
                      disabled={submitting}
                      className="min-w-0 flex-1 bg-white px-3.5 py-2.5 font-mono text-xs text-slate-900 outline-none placeholder:text-slate-400 disabled:bg-slate-50"
                      placeholder="my-shop"
                    />

                  </div>

                  <p className="mt-1 text-[10px] text-slate-400">
                    This is currently a preview only and is not
                    stored in branches.
                  </p>

                </div>

                {/* PHOTO */}

                <div className="min-h-0">

                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`relative flex min-h-[150px] flex-col items-center justify-center rounded-2xl border-2 border-dashed p-5 text-center transition ${
                      isDragging
                        ? "border-[#059669] bg-emerald-50"
                        : "border-emerald-200 bg-emerald-50/20 hover:bg-emerald-50/40"
                    }`}
                  >

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg"
                      className="hidden"
                      onChange={handleFileInputChange}
                    />

                    <span className="absolute right-4 top-3.5 text-[10px] font-medium text-slate-400">
                      Drag &amp; drop support
                    </span>

                    {photoPreview ? (
                      <div className="flex flex-col items-center">

                        <img
                          src={photoPreview}
                          alt="Shop preview"
                          className="mb-3 h-20 w-20 rounded-xl border border-slate-200 object-cover shadow-sm"
                        />

                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() =>
                            fileInputRef.current?.click()
                          }
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                        >
                          Change photo
                        </button>

                      </div>
                    ) : (
                      <>
                        <div className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-[#059669]">

                          <svg
                            className="h-5 w-5 fill-current"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <path d="M4 4h3l2-2h6l2 2h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm8 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" />
                          </svg>

                        </div>

                        <p className="text-xs font-bold text-slate-900">
                          Add your shop photo
                        </p>

                        <p className="mb-3 mt-0.5 text-[11px] text-slate-500">
                          Help customers recognize your shop
                        </p>

                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() =>
                            fileInputRef.current?.click()
                          }
                          className="cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Upload shop photo
                        </button>

                        <span className="mt-2 text-[10px] text-slate-400">
                          JPG, PNG • Up to 5 MB
                        </span>
                      </>
                    )}

                  </div>

                </div>

                {/* ACTION */}

                <div className="flex shrink-0 flex-col gap-3 pt-1 sm:flex-row sm:items-center">

                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-xl bg-[#059669] px-6 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#047857] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? (
                      <span className="flex items-center gap-2">

                        <span className="h-3 w-3 animate-spin rounded-full border border-white/40 border-t-white" />

                        Saving...

                      </span>
                    ) : (
                      "Save and continue"
                    )}
                  </button>

                  <p className="text-xs leading-tight text-slate-500">
                    Your shop profile will be visible to customers
                    on your{" "}
                    <span className="font-semibold text-slate-700">
                      SmartPrinter page
                    </span>
                    .
                  </p>

                </div>

              </div>

              {/* ==================================================
                  RIGHT COLUMN
              ================================================== */}

              <div className="flex min-h-0 flex-col gap-3 lg:col-span-6">

                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  PREVIEW
                </div>

                <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-3xl border border-slate-100 bg-[#f8fafc] p-3 shadow-inner lg:p-5">

                  <svg
                    className="h-full max-h-[calc(100vh-170px)] w-auto max-w-full drop-shadow-xl"
                    viewBox="0 0 340 440"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-label="SmartPrinter kiosk preview"
                  >

                    {/* Main kiosk body */}

                    <path
                      d="M60 120L110 50H230L280 120V400H60V120Z"
                      fill="#059669"
                    />

                    {/* Side bevel */}

                    <path
                      d="M230 50L280 120V400H260V130L220 70H230Z"
                      fill="#047857"
                    />

                    {/* Faceplate */}

                    <rect
                      x="80"
                      y="130"
                      width="180"
                      height="240"
                      rx="12"
                      fill="white"
                      stroke="#e2e8f0"
                      strokeWidth="1.5"
                    />

                    {/* Header */}

                    <rect
                      x="110"
                      y="65"
                      width="120"
                      height="20"
                      rx="4"
                      fill="#047857"
                    />

                    <text
                      x="170"
                      y="79"
                      fill="white"
                      fontSize="8"
                      fontWeight="bold"
                      textAnchor="middle"
                      letterSpacing="1"
                    >
                      COLLECT PRINT HERE
                    </text>

                    {/* Logo */}

                    <text
                      x="170"
                      y="155"
                      fill="#059669"
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

                    {/* QR container */}

                    <rect
                      x="120"
                      y="178"
                      width="100"
                      height="100"
                      rx="8"
                      fill="#f8fafc"
                      stroke="#cbd5e1"
                    />

                    {/* QR pattern */}

                    <rect
                      x="130"
                      y="188"
                      width="24"
                      height="24"
                      rx="3"
                      fill="#0f172a"
                    />

                    <rect
                      x="134"
                      y="192"
                      width="16"
                      height="16"
                      rx="2"
                      fill="#f8fafc"
                    />

                    <rect
                      x="138"
                      y="196"
                      width="8"
                      height="8"
                      rx="1"
                      fill="#0f172a"
                    />

                    <rect
                      x="186"
                      y="188"
                      width="24"
                      height="24"
                      rx="3"
                      fill="#0f172a"
                    />

                    <rect
                      x="190"
                      y="192"
                      width="16"
                      height="16"
                      rx="2"
                      fill="#f8fafc"
                    />

                    <rect
                      x="194"
                      y="196"
                      width="8"
                      height="8"
                      rx="1"
                      fill="#0f172a"
                    />

                    <rect
                      x="130"
                      y="244"
                      width="24"
                      height="24"
                      rx="3"
                      fill="#0f172a"
                    />

                    <rect
                      x="134"
                      y="248"
                      width="16"
                      height="16"
                      rx="2"
                      fill="#f8fafc"
                    />

                    <rect
                      x="138"
                      y="252"
                      width="8"
                      height="8"
                      rx="1"
                      fill="#0f172a"
                    />

                    <rect
                      x="160"
                      y="192"
                      width="6"
                      height="6"
                      fill="#0f172a"
                    />

                    <rect
                      x="170"
                      y="202"
                      width="8"
                      height="6"
                      fill="#0f172a"
                    />

                    <rect
                      x="164"
                      y="218"
                      width="12"
                      height="12"
                      fill="#0f172a"
                    />

                    <rect
                      x="186"
                      y="236"
                      width="6"
                      height="6"
                      fill="#0f172a"
                    />

                    <rect
                      x="196"
                      y="246"
                      width="10"
                      height="8"
                      fill="#0f172a"
                    />

                    <rect
                      x="176"
                      y="258"
                      width="6"
                      height="6"
                      fill="#0f172a"
                    />

                    {/* Feature labels */}

                    <text
                      x="110"
                      y="292"
                      fill="#64748b"
                      fontSize="7"
                      fontWeight="bold"
                    >
                      Upload
                    </text>

                    <text
                      x="160"
                      y="292"
                      fill="#64748b"
                      fontSize="7"
                      fontWeight="bold"
                    >
                      Pay
                    </text>

                    <text
                      x="202"
                      y="292"
                      fill="#64748b"
                      fontSize="7"
                      fontWeight="bold"
                    >
                      Print
                    </text>

                    {/* User illustration */}

                    <circle
                      cx="130"
                      cy="335"
                      r="18"
                      fill="#d1fae5"
                      stroke="#059669"
                      strokeWidth="1.5"
                    />

                    <circle
                      cx="126"
                      cy="333"
                      r="2.5"
                      fill="#059669"
                    />

                    <circle
                      cx="134"
                      cy="333"
                      r="2.5"
                      fill="#059669"
                    />

                    <path
                      d="M126 339Q130 343 134 339"
                      stroke="#059669"
                      strokeWidth="1.5"
                    />

                    <rect
                      x="122"
                      y="353"
                      width="16"
                      height="14"
                      rx="4"
                      fill="#059669"
                    />

                    <text
                      x="156"
                      y="335"
                      fill="#059669"
                      fontSize="8"
                      fontWeight="bold"
                    >
                      SMART PRINTING
                    </text>

                    <text
                      x="156"
                      y="345"
                      fill="#0f172a"
                      fontSize="7"
                      fontWeight="bold"
                    >
                      SMARTER GENERATION
                    </text>

                    {/* Side port */}

                    <rect
                      x="264"
                      y="160"
                      width="12"
                      height="28"
                      rx="3"
                      fill="#064e3b"
                    />

                    {/* Base feet */}

                    <rect
                      x="75"
                      y="400"
                      width="20"
                      height="8"
                      rx="2"
                      fill="#334155"
                    />

                    <rect
                      x="245"
                      y="400"
                      width="20"
                      height="8"
                      rx="2"
                      fill="#334155"
                    />

                  </svg>

                </div>

              </div>

            </form>
          )}

        </div>

      </main>
    </div>
  );
}