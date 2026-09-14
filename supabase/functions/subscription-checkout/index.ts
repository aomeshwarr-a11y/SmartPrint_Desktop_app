// supabase/functions/subscription-checkout/index.ts
//
// Trusted server-side payment processing for SmartPrinter subscriptions.
// Owned by the main website (smartprinter.in).
//
// Responsibilities:
// 1. Order Creation: Calls Razorpay Orders API securely using RAZORPAY_KEY_SECRET.
// 2. Cryptographic Signature Verification: Computes HMAC-SHA256 on order_id|payment_id.
// 3. Idempotency: Checks public.payments before processing so duplicate requests never double-apply.
// 4. Downgrade Protection: Prevents target_slots from falling below branch.slots_taken.
// 5. Database Synchronization: Inserts into public.payments and updates branches.slots_total.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { handleCors, json } from "../_shared/cors.ts";
import { verifyUserSession, verifyBranchAuthorization } from "../_shared/auth.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";

const PRICING_TIERS: Record<number, { amount: number; name: string }> = {
  1: { amount: 499, name: "1 Printer Starter License" },
  2: { amount: 899, name: "2 Printers Pro License" },
  3: { amount: 1299, name: "3 Printers Business License" },
};

const getEnv = (key: string): string => {
  if (typeof Deno !== "undefined" && Deno.env) {
    return Deno.env.get(key) || "";
  }
  return (typeof process !== "undefined" && process.env ? process.env[key] : "") || "";
};

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleSubscriptionCheckout(req: Request): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405);
  }

  try {
    const supabaseUrl = getEnv("SUPABASE_URL");
    const anonKey = getEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const razorpayKeyId = getEnv("RAZORPAY_KEY_ID");
    const razorpayKeySecret = getEnv("RAZORPAY_KEY_SECRET");

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Server misconfiguration: missing Supabase credentials." }, 500);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    // 1. Authenticate user caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Unauthorized: Missing Authorization header." }, 401);
    }

    const callerClient = createClient(supabaseUrl, anonKey || serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const user = await verifyUserSession(callerClient);
    if (!user) {
      return json({ error: "Unauthorized: Invalid user session." }, 401);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ error: "Invalid JSON request body." }, 400);
    }

    const action = String(body.action || "").trim();
    const branchId = String(body.branch_id || "").trim();
    const targetSlots = Number(body.target_slots);

    if (!branchId) {
      return json({ error: "Missing required field: branch_id." }, 400);
    }

    if (!PRICING_TIERS[targetSlots]) {
      return json({ error: `Invalid target_slots: ${targetSlots}. Must be 1, 2, or 3.` }, 400);
    }

    // 2. Verify caller has authority over branch (owner or manager)
    const isAuthorized = await verifyBranchAuthorization(
      serviceClient,
      callerClient,
      user.id,
      branchId
    );

    if (!isAuthorized) {
      return json({ error: "Forbidden: Not authorized to manage subscriptions for this branch." }, 403);
    }

    // Fetch current branch state
    const { data: branch, error: branchErr } = await serviceClient
      .from("branches")
      .select("id, name, slots_total, slots_taken")
      .eq("id", branchId)
      .maybeSingle();

    if (branchErr || !branch) {
      return json({ error: "Branch not found." }, 404);
    }

    // -------------------------------------------------------------------------
    // ACTION A: CREATE ORDER
    // -------------------------------------------------------------------------
    if (action === "create-order") {
      // Downgrade protection check before creating order
      if (targetSlots < branch.slots_taken) {
        return json({
          error: `Cannot downgrade to ${targetSlots} printer(s) while ${branch.slots_taken} printer(s) are currently authorized. Please unauthorize active printers in the Desktop App before downgrading.`
        }, 400);
      }

      if (!razorpayKeyId || !razorpayKeySecret) {
        return json({ error: "Server misconfiguration: Razorpay credentials not set." }, 500);
      }

      const tier = PRICING_TIERS[targetSlots];
      const amountPaise = tier.amount * 100;
      const receiptId = `sub_${branchId.slice(0, 8)}_${Date.now()}`;

      const basicAuth = btoa(`${razorpayKeyId}:${razorpayKeySecret}`);
      const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          "Authorization": `Basic ${basicAuth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: amountPaise,
          currency: "INR",
          receipt: receiptId,
          notes: {
            branch_id: branchId,
            user_id: user.id,
            target_slots: targetSlots,
            plan_name: tier.name,
          },
        }),
      });

      if (!rzpRes.ok) {
        const errText = await rzpRes.text();
        console.error("Razorpay order creation error:", errText);
        return json({ error: "Failed to create Razorpay order." }, 502);
      }

      const orderData = await rzpRes.json();
      return json({
        order_id: orderData.id,
        amount: orderData.amount,
        currency: orderData.currency,
        key_id: razorpayKeyId,
        plan_name: tier.name,
        target_slots: targetSlots,
      });
    }

    // -------------------------------------------------------------------------
    // ACTION B: VERIFY PAYMENT
    // -------------------------------------------------------------------------
    if (action === "verify-payment") {
      const razorpayOrderId = String(body.razorpay_order_id || "").trim();
      const razorpayPaymentId = String(body.razorpay_payment_id || "").trim();
      const razorpaySignature = String(body.razorpay_signature || "").trim();

      if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
        return json({ error: "Missing required payment verification fields." }, 400);
      }

      if (!razorpayKeySecret) {
        return json({ error: "Server misconfiguration: RAZORPAY_KEY_SECRET missing." }, 500);
      }

      // 1. Cryptographic HMAC-SHA256 verification
      const payloadToSign = `${razorpayOrderId}|${razorpayPaymentId}`;
      const expectedSignature = await hmacSha256Hex(razorpayKeySecret, payloadToSign);

      if (!timingSafeEqual(expectedSignature, razorpaySignature)) {
        console.warn(`Payment signature verification failed for payment ${razorpayPaymentId}`);
        return json({ error: "Invalid payment signature. Verification failed." }, 400);
      }

      // 2. Idempotency Check (Without assuming a DB UNIQUE constraint on razorpay_payment_id)
      const { data: existingPayment } = await serviceClient
        .from("payments")
        .select("id, status, branch_id, amount")
        .eq("razorpay_payment_id", razorpayPaymentId)
        .maybeSingle();

      if (existingPayment) {
        console.log(`Payment ${razorpayPaymentId} already processed (idempotent no-op).`);
        return json({
          success: true,
          message: "Payment already verified and processed.",
          payment_id: existingPayment.id,
          slots_total: branch.slots_total,
          already_processed: true,
        });
      }

      // 3. Downgrade Protection Check
      if (targetSlots < branch.slots_taken) {
        console.warn(`Downgrade rejected: target ${targetSlots} < active ${branch.slots_taken}`);
        return json({
          error: `Cannot downgrade to ${targetSlots} printer(s) while ${branch.slots_taken} printer(s) are currently authorized. Please unauthorize printers first.`
        }, 400);
      }

      const tier = PRICING_TIERS[targetSlots];

      // 4. Record successful payment in public.payments
      const { data: insertedPayment, error: payInsertErr } = await serviceClient
        .from("payments")
        .insert({
          user_id: user.id,
          branch_id: branchId,
          payment_type: "subscription",
          amount: tier.amount,
          status: "succeeded",
          razorpay_order_id: razorpayOrderId,
          razorpay_payment_id: razorpayPaymentId,
          notes: `Plan: ${targetSlots} Printers License (${tier.name})`,
          processed_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (payInsertErr) {
        console.error("Failed to record payment in database:", payInsertErr);
        return json({ error: "Database error recording payment." }, 500);
      }

      // 5. Update branches.slots_total to the purchased capacity
      const { error: branchUpdateErr } = await serviceClient
        .from("branches")
        .update({
          slots_total: targetSlots,
          is_active: true,
        })
        .eq("id", branchId);

      if (branchUpdateErr) {
        console.error("Failed to update branch slots_total:", branchUpdateErr);
        return json({ error: "Payment recorded but failed to update printer quota." }, 500);
      }

      console.log(`Subscription upgraded: Branch ${branchId} slots_total updated to ${targetSlots}`);

      return json({
        success: true,
        message: `Payment verified. Plan upgraded to ${targetSlots} printer(s).`,
        payment_id: insertedPayment.id,
        slots_total: targetSlots,
        slots_taken: branch.slots_taken,
      });
    }

    return json({ error: `Unknown action: '${action}'. Expected 'create-order' or 'verify-payment'.` }, 400);
  } catch (err) {
    console.error("Unexpected error in subscription-checkout:", err);
    return json({ error: "Internal server error." }, 500);
  }
}

if (typeof Deno !== "undefined" && Deno.serve) {
  Deno.serve(handleSubscriptionCheckout);
}
