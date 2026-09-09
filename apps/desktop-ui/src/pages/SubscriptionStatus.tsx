import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import StatusBadge from "../components/StatusBadge";

interface SubscriptionRow {
  id: string;
  plan: string;
  status: "pending" | "active" | "past_due" | "cancelled";
  current_period_end: string | null;
}

export default function SubscriptionStatus() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    async function loadSubscription() {
      if (!session) return;
      const { data: shop } = await supabase.from("shops").select("id").eq("owner_user_id", session.user.id).maybeSingle();
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
      setSubscription(data as SubscriptionRow | null);
      setLoading(false);
    }
    void loadSubscription();
  }, [session]);

  async function startCheckout(plan: "monthly" | "yearly") {
    setStarting(true);
    try {
      // In production this calls a Supabase Edge Function that creates a Razorpay order
      // server-side and returns a checkout URL/id - never create the Razorpay order
      // directly from the renderer with a secret key. See supabase/functions and
      // docs/DEPLOYMENT.md for wiring the real Razorpay checkout flow.
      await window.smartprinter.openExternal(`https://smartprinter.in/checkout?plan=${plan}`);
    } finally {
      setStarting(false);
    }
  }

  if (loading) return <p className="text-brand-500">Loading...</p>;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-xl font-semibold text-brand-900">Subscription</h1>
      <p className="mb-6 text-sm text-brand-500">Activate automation for your shop.</p>

      <div className="card mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-brand-500">Current plan</p>
            <p className="text-lg font-semibold text-brand-900">{subscription?.plan ?? "No active plan"}</p>
          </div>
          <StatusBadge status={subscription?.status ?? "pending"} />
        </div>
        {subscription?.current_period_end && (
          <p className="mt-2 text-xs text-brand-500">Renews {new Date(subscription.current_period_end).toLocaleDateString()}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <p className="text-sm font-medium text-brand-900">Monthly</p>
          <p className="mb-4 text-2xl font-semibold text-brand-900">₹999<span className="text-sm font-normal text-brand-500">/mo</span></p>
          <button className="btn-primary w-full" disabled={starting} onClick={() => startCheckout("monthly")}>
            Choose monthly
          </button>
        </div>
        <div className="card border-brand-500">
          <p className="text-sm font-medium text-brand-900">Yearly (save 2 months)</p>
          <p className="mb-4 text-2xl font-semibold text-brand-900">₹9990<span className="text-sm font-normal text-brand-500">/yr</span></p>
          <button className="btn-primary w-full" disabled={starting} onClick={() => startCheckout("yearly")}>
            Choose yearly
          </button>
        </div>
      </div>

      {subscription?.status === "active" && (
        <button className="btn-secondary mt-6 w-full" onClick={() => navigate("/pairing")}>
          Continue to device pairing
        </button>
      )}
    </div>
  );
}
