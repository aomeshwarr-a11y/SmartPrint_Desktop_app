// supabase/functions/razorpay-webhook/index.ts
//
// This is the ONLY place in the entire system where a payment is considered
// "successful". The browser's Razorpay Checkout success callback is used purely for UI
// optimism (show a spinner, poll for the order flipping to `paid`) - it must never
// directly create a print_jobs row or mark an order/subscription paid. See
// ARCHITECTURE.md §10.
//
// Configure in the Razorpay dashboard: webhook URL = this function's URL, and set the
// same secret as an Edge Function secret:
//   supabase secrets set RAZORPAY_WEBHOOK_SECRET=<value from Razorpay dashboard>
//
// Idempotency: Razorpay may redeliver the same webhook more than once (network retries,
// etc). We rely on `payments.razorpay_payment_id` being UNIQUE (see migrations/0001)
// and treat a duplicate-key insert as a successful no-op, not an error.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature");
  const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");

  if (!webhookSecret) {
    console.error("RAZORPAY_WEBHOOK_SECRET is not configured.");
    return json({ error: "Server misconfiguration." }, 500);
  }
  if (!signature) {
    return json({ error: "Missing signature." }, 400);
  }

  const expectedSignature = await hmacSha256Hex(webhookSecret, rawBody);
  if (!timingSafeEqual(expectedSignature, signature)) {
    console.warn("Razorpay webhook signature mismatch - rejecting.");
    return json({ error: "Invalid signature." }, 401);
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "Malformed JSON body." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    switch (event.event) {
      case "payment.captured":
        await handlePaymentCaptured(serviceClient, event);
        break;
      case "payment.failed":
        await handlePaymentFailed(serviceClient, event);
        break;
      case "subscription.activated":
      case "subscription.charged":
        await handleSubscriptionActivated(serviceClient, event);
        break;
      case "refund.processed":
        await handleRefundProcessed(serviceClient, event);
        break;
      default:
        console.log(`Unhandled Razorpay event type: ${event.event}`);
    }

    await serviceClient.from("audit_logs").insert({
      actor_type: "system",
      action: `razorpay_webhook:${event.event}`,
      detail: { id: event?.payload?.payment?.entity?.id ?? null },
    });

    return json({ received: true });
  } catch (err) {
    console.error("razorpay-webhook processing error", err);
    // Return 500 so Razorpay retries - but note the idempotency guards above/below mean
    // a retry after a partial failure will not double-apply the payment.
    return json({ error: "Internal error processing webhook." }, 500);
  }
});

async function handlePaymentCaptured(client: ReturnType<typeof createClient>, event: any) {
  const payment = event.payload?.payment?.entity;
  if (!payment) return;

  const notes = payment.notes ?? {};
  const orderIdFromNotes = notes.smartprinter_order_id ?? null; // set when creating the Razorpay order (customer print order flow)
  const subscriptionIdFromNotes = notes.smartprinter_subscription_id ?? null; // set for owner subscription checkout

  const { error: insertError } = await client.from("payments").upsert(
    {
      razorpay_payment_id: payment.id,
      razorpay_order_id: payment.order_id,
      order_id: orderIdFromNotes,
      subscription_id: subscriptionIdFromNotes,
      status: "succeeded",
      amount: payment.amount / 100, // Razorpay amounts are in paise
      verified_at: new Date().toISOString(),
    },
    { onConflict: "razorpay_payment_id" },
  );

  if (insertError) {
    console.error("Failed to upsert payment", insertError);
    throw insertError;
  }

  if (orderIdFromNotes) {
    await client.from("orders").update({ status: "paid" }).eq("id", orderIdFromNotes);

    // Only NOW - after server-side verification - do we create the print_jobs row(s)
    // for this order's item(s). This is the critical control described in
    // ARCHITECTURE.md §10: "the browser's payment success callback is used only for
    // UI optimism, never to trigger job creation."
    const { data: items } = await client
      .from("order_items")
      .select("id, file_storage_path, settings, order:orders(shop_id)")
      .eq("order_id", orderIdFromNotes);

    for (const item of items ?? []) {
      const shopId = (item as any).order?.shop_id;
      if (!shopId) continue;

      const { data: printer } = await client
        .from("printers")
        .select("id, device_id")
        .eq("branch_id", shopId) // NOTE: assumes a 1:1 shop->branch simplification for MVP - see ARCHITECTURE.md assumptions
        .eq("authorized", true)
        .limit(1)
        .maybeSingle();

      if (!printer?.device_id) {
        console.warn(`No authorized printer/device found for shop ${shopId} - job not created.`);
        continue;
      }

      await client.from("print_jobs").insert({
        order_item_id: item.id,
        device_id: printer.device_id,
        printer_id: printer.id,
        storage_path: (item as any).file_storage_path,
        status: "queued",
        idempotency_key: `order-item-${item.id}`,
        print_options: (item as any).settings ?? {},
      });
    }
  }
}

async function handlePaymentFailed(client: ReturnType<typeof createClient>, event: any) {
  const payment = event.payload?.payment?.entity;
  if (!payment) return;

  await client.from("payments").upsert(
    {
      razorpay_payment_id: payment.id,
      razorpay_order_id: payment.order_id,
      status: "failed",
      amount: payment.amount ? payment.amount / 100 : null,
    },
    { onConflict: "razorpay_payment_id" },
  );

  const orderIdFromNotes = payment.notes?.smartprinter_order_id;
  if (orderIdFromNotes) {
    await client.from("orders").update({ status: "failed" }).eq("id", orderIdFromNotes);
  }
}

async function handleSubscriptionActivated(client: ReturnType<typeof createClient>, event: any) {
  const subscriptionEntity = event.payload?.subscription?.entity;
  if (!subscriptionEntity) return;

  await client
    .from("subscriptions")
    .update({
      status: "active",
      current_period_end: subscriptionEntity.current_end
        ? new Date(subscriptionEntity.current_end * 1000).toISOString()
        : null,
    })
    .eq("razorpay_subscription_id", subscriptionEntity.id);

  await client.from("subscription_events").insert({
    subscription_id: subscriptionEntity.id,
    event_type: event.event,
    raw_payload: event,
  });
}

async function handleRefundProcessed(client: ReturnType<typeof createClient>, event: any) {
  const refund = event.payload?.refund?.entity;
  if (!refund) return;

  await client.from("payments").update({ status: "refunded" }).eq("razorpay_payment_id", refund.payment_id);

  const { data: payment } = await client
    .from("payments")
    .select("order_id")
    .eq("razorpay_payment_id", refund.payment_id)
    .maybeSingle();

  if (payment?.order_id) {
    await client.from("orders").update({ status: "refunded" }).eq("id", payment.order_id);
  }
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
