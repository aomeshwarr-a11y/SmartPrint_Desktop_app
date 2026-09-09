// supabase/functions/device-pairing-confirm/index.ts
//
// Called by the desktop agent with the pairing code shown in the UI. No owner auth
// header is required here (the desktop agent is not logged in as the owner) - the
// security boundary is the pairing code itself: short-lived, single-use, and only ever
// created by an authenticated owner (see device-pairing-create). On success this mints
// the permanent device credential (device_secret) that the agent will encrypt with
// DPAPI and use for all future device-token-refresh calls.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  try {
    const body = await req.json().catch(() => null);
    const pairingCode = body?.pairing_code;
    if (!pairingCode || typeof pairingCode !== "string") {
      return json({ error: "Missing pairing_code." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: pairingRequest, error: lookupError } = await serviceClient
      .from("device_pairing_requests")
      .select("id, shop_id, expires_at, confirmed_at")
      .eq("pairing_code", pairingCode)
      .maybeSingle();

    if (lookupError || !pairingRequest) {
      return json({ error: "Invalid pairing code." }, 404);
    }
    if (pairingRequest.confirmed_at) {
      return json({ error: "This pairing code has already been used." }, 409);
    }
    if (new Date(pairingRequest.expires_at).getTime() < Date.now()) {
      return json({ error: "This pairing code has expired. Generate a new one." }, 410);
    }

    const { data: device, error: deviceError } = await serviceClient
      .from("devices")
      .insert({ shop_id: pairingRequest.shop_id, name: "Shop PC", status: "active" })
      .select("id")
      .single();

    if (deviceError || !device) {
      console.error("Failed to create device", deviceError);
      return json({ error: "Could not create device." }, 500);
    }

    const deviceSecret = generateDeviceSecret();
    const tokenHash = await sha256Hex(deviceSecret);

    const { error: tokenError } = await serviceClient.from("device_tokens").insert({
      device_id: device.id,
      token_hash: tokenHash,
    });

    if (tokenError) {
      console.error("Failed to store device token hash", tokenError);
      return json({ error: "Could not issue device credential." }, 500);
    }

    await serviceClient
      .from("device_pairing_requests")
      .update({ confirmed_at: new Date().toISOString() })
      .eq("id", pairingRequest.id);

    await serviceClient.from("device_events").insert({
      device_id: device.id,
      event_type: "paired",
    });
    await serviceClient.from("audit_logs").insert({
      actor_type: "device",
      actor_id: device.id,
      action: "device_paired",
      target: pairingRequest.shop_id,
    });

    // device_secret is returned exactly once, in this response - it is never stored in
    // plaintext anywhere server-side (only its SHA-256 hash is persisted).
    return json({ device_id: device.id, shop_id: pairingRequest.shop_id, device_secret: deviceSecret });
  } catch (err) {
    console.error("device-pairing-confirm error", err);
    return json({ error: "Internal error." }, 500);
  }
});

function generateDeviceSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
