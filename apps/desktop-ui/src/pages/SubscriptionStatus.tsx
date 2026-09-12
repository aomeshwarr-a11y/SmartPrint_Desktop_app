import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import StatusBadge from "../components/StatusBadge";

interface SubscriptionRow {
  id: string;
  plan: string;
  status: "pending" | "active" | "past_due" | "cancelled";
  current_period_end: string | null;
}

interface InvoiceRecord {
  id: string;
  billingDate: string;
  planScope: string;
  paymentMethod: string;
  amount: string;
  status: "Paid" | "Pending" | "Failed";
}

export default function SubscriptionStatus() {
  const { session } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    async function loadSubscription() {
      if (!session) return;
      const { data: shop } = await supabase
        .from("shops")
        .select("id")
        .eq("owner_user_id", session.user.id)
        .maybeSingle();

      if (!shop) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("subscriptions")
        .select("id, plan, status, current_period_end")
        .eq("shop_id", shop.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const subRow = data as SubscriptionRow | null;
      setSubscription(subRow);

      if (subRow) {
        const { data: paymentsData } = await supabase
          .from("payments")
          .select("id, razorpay_payment_id, status, amount, verified_at, created_at")
          .eq("subscription_id", subRow.id)
          .order("created_at", { ascending: false });

        if (paymentsData && paymentsData.length > 0) {
          setInvoices(
            paymentsData.map((p) => ({
              id: p.razorpay_payment_id ? `#${p.razorpay_payment_id}` : `#PAY-${p.id.slice(0, 8).toUpperCase()}`,
              billingDate: new Date(p.verified_at || p.created_at).toLocaleDateString("en-IN", {
                month: "short",
                day: "numeric",
                year: "numeric",
              }),
              planScope: subRow.plan
                ? `${subRow.plan.charAt(0).toUpperCase() + subRow.plan.slice(1)} Automation License`
                : "Shop Subscription",
              paymentMethod: p.razorpay_payment_id ? "Razorpay AutoPay" : "Direct Gateway",
              amount: `₹${(p.amount / 100).toLocaleString("en-IN")}`,
              status: p.status === "captured" ? "Paid" : p.status === "pending" ? "Pending" : "Failed",
            }))
          );
        }
      }

      setLoading(false);
    }

    void loadSubscription();
  }, [session]);

  async function startCheckout(plan: "monthly" | "yearly") {
    setStarting(true);
    try {
      if (window.smartprinter?.openExternal) {
        await window.smartprinter.openExternal(
          `https://smartprinter.in/checkout?plan=${plan}`
        );
      } else {
        window.open(`https://smartprinter.in/checkout?plan=${plan}`, "_blank");
      }
    } finally {
      setStarting(false);
    }
  }

  const handleDownloadInvoice = (invoiceId: string) => {
    // In production, triggers authenticated download link from Supabase Storage / Razorpay invoice URL
    alert(`Downloading PDF tax invoice for ${invoiceId}`);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-12 text-xs text-slate-400">
        <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent mr-2" />
        Loading subscription status...
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#faf8ff] p-6 lg:p-8 text-slate-800 select-none font-sans">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400 mb-1">
            <span>Supabase: subscriptions table</span>
            <span>/</span>
            <span>SubscriptionStatus.tsx</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 lg:text-2xl">
            Subscription
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Activate automation for your shop.
          </p>
        </div>

        {/* Current Plan Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Current plan
              </p>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {subscription?.plan ?? "No active plan"}
              </p>
            </div>
            <StatusBadge status={subscription?.status ?? "pending"} />
          </div>

          {subscription?.current_period_end && (
            <p className="mt-3 border-t border-slate-100 pt-2.5 text-xs text-slate-500 font-medium">
              Renews {new Date(subscription.current_period_end).toLocaleDateString()}
            </p>
          )}
        </div>

        {/* Plan Cards Grid */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Available shop licenses
          </h2>
          <span className="text-[11px] font-medium text-slate-400">
            Billed in INR (₹)
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {/* Monthly Plan */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-slate-900">Monthly</p>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  Flexibility
                </span>
              </div>
              <p className="mt-3 text-3xl font-extrabold text-slate-900">
                ₹1<span className="text-sm font-normal text-slate-500">/mo</span>
              </p>
              <ul className="mt-4 space-y-2 text-xs text-slate-600">
                <li className="flex items-center gap-1.5">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span>Unlimited automated print queues</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span>Local agent heartbeat &amp; failover</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span>Live telemetry &amp; consumables alerts</span>
                </li>
              </ul>
            </div>

            <button
              type="button"
              disabled={starting}
              onClick={() => startCheckout("monthly")}
              className="mt-6 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-600/30 bg-emerald-50 px-4 py-2.5 text-xs font-bold text-emerald-800 shadow-2xs hover:bg-emerald-100 active:bg-emerald-200 transition disabled:opacity-50 cursor-pointer"
            >
              Choose monthly ↗
            </button>
          </div>

          {/* Yearly Plan */}
          <div className="rounded-2xl border-2 border-emerald-600 bg-white p-5 shadow-sm relative flex flex-col justify-between">
            <span className="absolute -top-3 right-4 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-bold text-white uppercase tracking-wide shadow-2xs">
              Recommended
            </span>
            <div>
              <div>
                <p className="text-sm font-bold text-slate-900">Yearly</p>
                <p className="text-[11px] font-medium text-emerald-700">Save 2 months</p>
              </div>
              <p className="mt-3 text-3xl font-extrabold text-slate-900">
                ₹10<span className="text-sm font-normal text-slate-500">/yr</span>
              </p>
              <ul className="mt-4 space-y-2 text-xs text-slate-600">
                <li className="flex items-center gap-1.5">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span>All Monthly suite features included</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span>Priority printer routing &amp; failover engine</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span>Annual shop health audit telemetry</span>
                </li>
              </ul>
            </div>

            <button
              type="button"
              disabled={starting}
              onClick={() => startCheckout("yearly")}
              className="mt-6 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-2xs hover:bg-emerald-700 active:bg-emerald-800 transition disabled:opacity-50 cursor-pointer"
            >
              Choose yearly ↗
            </button>
          </div>
        </div>

        {/* 3. PREVIOUS INVOICES & BILLING RECEIPTS */}
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/40">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900">Invoice History &amp; Billing Receipts</span>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-mono text-slate-500">
                {invoices.length} receipts
              </span>
            </div>
            <span className="text-[11px] font-medium text-emerald-700 flex items-center gap-1">
              ✓ GST Compliant (HQ-MAIN)
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <th className="py-3 px-4">Invoice ID</th>
                  <th className="py-3 px-4">Billing Date</th>
                  <th className="py-3 px-4">Plan &amp; Scope</th>
                  <th className="py-3 px-4">Payment Method</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-center">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      No billing receipts found for this shop.
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

        {/* Informational Callout */}
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 text-xs text-slate-600 shadow-2xs">
          <div className="flex items-start gap-2.5">
            <span className="text-base text-emerald-600">ℹ️</span>
            <div>
              <p className="font-bold text-slate-800">
                Payment Flow &amp; Edge Automation
              </p>
              <p className="mt-0.5 text-slate-500 leading-relaxed">
                In production this calls a Supabase Edge Function that creates a Razorpay order server-side and opens the checkout link. Once payment succeeds, webhooks mark the subscription active.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}