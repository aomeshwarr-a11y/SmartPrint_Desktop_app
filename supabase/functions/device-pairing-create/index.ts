// supabase/functions/device-pairing-create/index.ts
//
// Called by the desktop agent (forwarding the OWNER's Supabase Auth access token, never
// stored by the agent) to start pairing this computer to the owner's shop. Requires the
// caller to be an authenticated shop owner - this is the security boundary that makes
// pairing safe: only someone who can already log in as the shop owner can mint a pairing
// code for that shop.
//
// Deploy: supabase functions deploy device-pairing-create
// Required secrets (supabase secrets set ...): none beyond the project's own
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, which Supabase injects automatically for
// Edge Functions - never hardcode them here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAIRING_CODE_EXPIRY_MINUTES = 10;

Deno.serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header - owner must be logged in." }, 401);
    }

    // Client bound to the CALLER's own JWT, so `auth.uid()` / RLS resolve to the owner -
    // we deliberately do NOT use the service_role client to look up the shop, so a bug
    // here can never accidentally return someone else's shop_id.
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) {
      return json({ error: "Invalid or expired owner session." }, 401);
    }

    const { data: shop, error: shopError } = await callerClient
      .from("shops")
      .select("id")
      .eq("owner_user_id", userData.user.id)
      .maybeSingle();

    if (shopError || !shop) {
      return json({ error: "No shop found for this account. Finish shop setup first." }, 400);
    }

    const pairingCode = generatePairingCode();
    const expiresAt = new Date(Date.now() + PAIRING_CODE_EXPIRY_MINUTES * 60_000).toISOString();

    // Writing the pairing request itself needs elevated privileges (the table has no
    // client RLS policy at all - see migrations/0003) so we use the service_role client
    // ONLY for this one insert, never to look up which shop the caller owns.
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error: insertError } = await serviceClient.from("device_pairing_requests").insert({
      shop_id: shop.id,
      pairing_code: pairingCode,
      expires_at: expiresAt,
    });

    if (insertError) {
      console.error("Failed to create pairing request", insertError);
      return json({ error: "Could not create pairing request." }, 500);
    }

    await serviceClient.from("audit_logs").insert({
      actor_type: "owner",
      actor_id: userData.user.id,
      action: "device_pairing_requested",
      target: shop.id,
    });

    return json({ pairing_code: pairingCode, expires_at: expiresAt });
  } catch (err) {
    console.error("device-pairing-create error", err);
    return json({ error: "Internal error." }, 500);
  }
});

function generatePairingCode(): string {
  // 6-digit numeric code - easy to read aloud/type, short expiry limits brute force risk.
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return n.toString().padStart(6, "0");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
