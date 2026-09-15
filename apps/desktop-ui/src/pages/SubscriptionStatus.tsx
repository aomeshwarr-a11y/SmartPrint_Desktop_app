import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import StatusBadge from "../components/StatusBadge";

interface BranchSubscriptionData {
  id: string;
  name: string;
  slots_total: number;
  slots_taken: number;
  is_active: boolean;
  created_at: string;
}

interface InvoiceRecord {
  id: string;
  billingDate: string;
  planScope: string;
  paymentMethod: string;
  amount: string;
  status: "Paid" | "Pending" | "Failed";
}

const PLAN_TIERS = [
  {
    slots: 1,
    title: "Starter Plan",
    printers: "1 Printer",
    price: "₹499",
    period: "/mo",
    badge: "Solo Kiosk",
    features: [
      "1 Windows spooler printer authorized",
      "Full cloud dispatch & Realtime streaming",
      "Local offline queue failover (SQLite)",
      "Customer QR code mobile upload",
    ],
  },
  {
    slots: 2,
    title: "Pro Fleet Plan",
    printers: "2 Printers",
    price: "₹899",
    period: "/mo",
    badge: "Recommended",
    features: [
      "Up to 2 Windows spooler printers authorized",
      "Auto-route Color vs Mono jobs",
      "Paper jam auto-pause & failover",
      "Fast simultaneous queue handling",
      "Save ₹99/mo compared to two single plans",
    ],
  },
  {
    slots: 3,
    title: "Business Multi-Counter",
    printers: "3 Printers",
    price: "₹1,299",
    period: "/mo",
    badge: "High Volume",
    features: [
      "Up to 3 Windows spooler printers authorized",
      "Multi-counter load balancing",
      "Consumables & toner telemetry alerts",
      "Dedicated high-throughput spooler channels",
      "Save ₹198/mo",
    ],
  },
];

export default function SubscriptionStatus() {
  const { session } = useAuth();
  const [branch, setBranch] = useState<BranchSubscriptionData | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  const loadSubscription = useCallback(async (showFeedback = false) => {
    if (!session?.user) {
      setLoading(false);
      return;
    }

    if (showFeedback) {
      setRefreshing(true);
    }

    try {
      // 1. Resolve branch where user is owner or manager, or via user_roles
      let activeBranchId: string | null = null;

      const { data: ownedBranch } = await supabase
        .from("branches")
        .select("id, name, slots_total, slots_taken, is_active, created_at")
        .or(`owner_id.eq.${session.user.id},manager_id.eq.${session.user.id}`)
        .limit(1)
        .maybeSingle();

      if (ownedBranch) {
        activeBranchId = ownedBranch.id;
        setBranch({
          ...ownedBranch,
          slots_total: Number(ownedBranch.slots_total ?? 1),
          slots_taken: Number(ownedBranch.slots_taken ?? 0),
        });
      } else {
        const { data: roleRow } = await supabase
          .from("user_roles")
          .select("branch_id, branches(id, name, slots_total, slots_taken, is_active, created_at)")
          .eq("user_id", session.user.id)
          .in("role", ["branch", "branch_owner", "shop_owner"])
          .limit(1)
          .maybeSingle();

        if (roleRow?.branch_id && roleRow.branches) {
          const b = roleRow.branches as any;
          activeBranchId = roleRow.branch_id;
          setBranch({
            id: b.id,
            name: b.name,
            slots_total: Number(b.slots_total ?? 1),
            slots_taken: Number(b.slots_taken ?? 0),
            is_active: Boolean(b.is_active),
            created_at: b.created_at,
          });
        }
      }

      // 2. Fetch payment receipts from public.payments
      if (activeBranchId) {
        const { data: paymentsData } = await supabase
          .from("payments")
          .select("id, razorpay_payment_id, payment_type, status, amount, notes, created_at")
          .eq("branch_id", activeBranchId)
          .order("created_at", { ascending: false })
          .limit(15);

        if (paymentsData && paymentsData.length > 0) {
          setInvoices(
            paymentsData.map((p) => ({
              id: p.razorpay_payment_id
                ? `#${p.razorpay_payment_id}`
                : `#PAY-${p.id.slice(0, 8).toUpperCase()}`,
              billingDate: new Date(p.created_at).toLocaleDateString("en-IN", {
                month: "short",
                day: "numeric",
                year: "numeric",
              }),
              planScope: p.notes || "Printer Subscription License",
              paymentMethod: p.razorpay_payment_id ? "Razorpay Gateway" : "Direct Settlement",
              amount: `₹${Number(p.amount).toLocaleString("en-IN")}`,
              status: p.status === "succeeded" || p.status === "captured"
                ? "Paid"
                : p.status === "pending"
                ? "Pending"
                : "Failed",
            }))
          );
        } else {
          setInvoices([]);
        }
      }

      if (showFeedback) {
        setFeedbackBanner("Subscription status and printer capacity refreshed from Supabase.");
        setTimeout(() => setFeedbackBanner(null), 3000);
      }
    } catch (err) {
      console.warn("Could not load subscription details:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session]);

  // Initial load
  useEffect(() => {
    void loadSubscription(false);
  }, [loadSubscription]);

  // Auto-refresh when user returns to Desktop app from browser
  useEffect(() => {
    const handleFocus = () => {
      void loadSubscription(false);
    };

    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [loadSubscription]);

  const handleOpenBillingOnWebsite = async (targetSlots?: number) => {
    if (!branch?.id) return;

    let targetUrl = `https://smartprinter.in/checkout?${branch.id}`;
    if (targetSlots) {
      targetUrl += `&plan_slots=${targetSlots}`;
    }

    try {
      if (window.smartprinter?.openExternal) {
        await window.smartprinter.openExternal(targetUrl);
      } else {
        window.open(targetUrl, "_blank");
      }
    } catch (err) {
      console.error("Failed to open external billing page:", err);
      window.open(targetUrl, "_blank");
    }
  };

  const handleDownloadInvoice = (invoiceId: string) => {
    alert(`Downloading PDF tax invoice for ${invoiceId}`);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-12 text-xs text-slate-400">
        <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent mr-2" />
        Loading subscription &amp; printer quota...
      </div>
    );
  }

  const currentSlots = branch?.slots_total ?? 1;
  const takenSlots = branch?.slots_taken ?? 0;
  const isAtCapacity = takenSlots >= currentSlots;

  return (
    <div className="flex-1 overflow-y-auto bg-[#faf8ff] p-6 lg:p-8 text-slate-800 select-none font-sans">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono text-slate-400 mb-1">
              <span>Billing &amp; Fleet Licensing</span>
              <span>/</span>
              <span className="text-emerald-700 font-semibold">{branch?.name ?? "My Shop"}</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 lg:text-2xl">
              Printer Subscriptions &amp; Quotas
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              Payments are securely managed on the main SmartPrinter website. Licensed printer slots are enforced locally in real time.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => void loadSubscription(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 active:bg-slate-100 transition disabled:opacity-50"
            >
              ↻ {refreshing ? "Refreshing..." : "Refresh Status"}
            </button>
            <Link
              to="/printers"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-emerald-700 active:bg-emerald-800 transition"
            >
              Manage Printers ({takenSlots}/{currentSlots}) →
            </Link>
          </div>
        </div>

        {feedbackBanner && (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800 font-medium shadow-2xs">
            {feedbackBanner}
          </div>
        )}

        {/* 1. CURRENT PLAN OVERVIEW CARD */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Active Branch Plan
              </p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-xl font-extrabold text-slate-900">
                  {currentSlots === 1
                    ? "1 Printer Starter Plan"
                    : currentSlots === 2
                    ? "2 Printers Pro Plan"
                    : `${currentSlots} Printers Business Plan`}
                </span>
                <span className="text-xs font-mono text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  {currentSlots} Licensed Slot{currentSlots > 1 ? "s" : ""}
                </span>
              </div>
            </div>
            <StatusBadge status={branch?.is_active ? "active" : "past_due"} />
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-500 font-medium">Printer Capacity Utilization:</span>
              <span className={`font-mono font-bold px-2 py-0.5 rounded ${
                isAtCapacity
                  ? "bg-amber-100 text-amber-900 border border-amber-200"
                  : "bg-slate-100 text-slate-800"
              }`}>
                {takenSlots} of {currentSlots} Slots Authorized
              </span>
            </div>

            {isAtCapacity ? (
              <span className="text-amber-700 font-semibold text-[11px] flex items-center gap-1">
                ⚠️ Plan limit reached. Upgrade on smartprinter.in to authorize additional printers.
              </span>
            ) : (
              <span className="text-emerald-700 font-semibold text-[11px] flex items-center gap-1">
                ✓ {currentSlots - takenSlots} slot{currentSlots - takenSlots > 1 ? "s" : ""} available to authorize
              </span>
            )}
          </div>
        </div>

        {/* 2. PLAN TIERS GRID */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Subscription License Tiers
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Select an option below to manage billing on the SmartPrinter website.
            </p>
          </div>
          <span className="text-[11px] font-medium text-slate-400">
            Billed in INR (₹)
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {PLAN_TIERS.map((tier) => {
            const isCurrent = currentSlots === tier.slots;
            const isUpgrade = tier.slots > currentSlots;

            return (
              <div
                key={tier.slots}
                className={`rounded-2xl border bg-white p-5 shadow-xs flex flex-col justify-between relative transition-all ${
                  isCurrent
                    ? "border-2 border-emerald-600 ring-4 ring-emerald-50"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                {tier.badge && (
                  <span className={`absolute -top-3 right-4 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-2xs ${
                    isCurrent
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-100 text-slate-600 border border-slate-200"
                  }`}>
                    {isCurrent ? "Active Plan" : tier.badge}
                  </span>
                )}

                <div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-slate-900">{tier.title}</p>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                      {tier.printers}
                    </span>
                  </div>

                  <p className="mt-3 text-3xl font-extrabold text-slate-900">
                    {tier.price}
                    <span className="text-sm font-normal text-slate-500">{tier.period}</span>
                  </p>

                  <ul className="mt-4 space-y-2 text-xs text-slate-600">
                    {tier.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="text-emerald-600 font-bold mt-0.5">✓</span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100">
                  {isCurrent ? (
                    <button
                      type="button"
                      disabled
                      className="w-full rounded-xl bg-slate-100 py-2.5 text-xs font-bold text-slate-500 cursor-default"
                    >
                      ✓ Current Active Plan
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleOpenBillingOnWebsite(tier.slots)}
                      className={`w-full inline-flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold shadow-2xs transition cursor-pointer ${
                        isUpgrade
                          ? "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800"
                          : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 active:bg-slate-100"
                      }`}
                    >
                      {isUpgrade ? `Upgrade to ${tier.printers} ↗` : `Manage Plan on smartprinter.in ↗`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 3. VERIFIED BILLING RECEIPTS FROM PUBLIC.PAYMENTS */}
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/40">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900">Verified Payment Receipts</span>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-mono text-slate-500">
                {invoices.length} recorded
              </span>
            </div>
            <span className="text-[11px] font-medium text-slate-400 font-mono">
              Source: public.payments
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <th className="py-3 px-4">Payment Ref</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Description</th>
                  <th className="py-3 px-4">Gateway</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-center">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      No recorded subscription payments found for this branch yet.
                    </td>
                  </tr>
                ) : (
                  invoices.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-bold text-emerald-700">
                        {invoice.id}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500 font-medium">
                        {invoice.billingDate}
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-slate-800">
                        {invoice.planScope}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 font-mono text-[11px]">
                        {invoice.paymentMethod}
                      </td>
                      <td className="py-3.5 px-4 font-extrabold text-slate-900">
                        {invoice.amount}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          {invoice.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => handleDownloadInvoice(invoice.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition cursor-pointer"
                        >
                          ⬇ PDF
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 4. SECURITY & PAYMENT ARCHITECTURE CALLOUT */}
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 text-xs text-slate-600 shadow-2xs">
          <div className="flex items-start gap-2.5">
            <span className="text-base text-emerald-600">🔒</span>
            <div>
              <p className="font-bold text-slate-800">
                Secure External Checkout Architecture
              </p>
              <p className="mt-0.5 text-slate-500 leading-relaxed">
                All checkout and payment interactions occur on <strong>smartprinter.in</strong> with trusted server-side HMAC-SHA256 signature verification.
                Your desktop client never stores payment credentials. Once payment is confirmed on the website, switch back to this desktop app to authorize your new printers.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}