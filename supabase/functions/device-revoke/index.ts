// supabase/functions/device-revoke/index.ts
//
// Two callers use this:
//   1. The desktop agent itself, on explicit "Unpair this computer" (best-effort - the
//      agent deletes its local DPAPI credential regardless of whether this call
//      succeeds).
//   2. The owner dashboard/web app, to revoke a lost/stolen/retired shop PC - this path
//      should go through a separate owner-authenticated function in a full
//      implementation; this file focuses on the device-initiated self-revoke described
//      in the blueprint's pairing flow.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  try {
    const body = await req.json().catch(() => null);
    const deviceId = body?.device_id;
    const deviceSecret = body?.device_secret;
    if (!deviceId || !deviceSecret) {
      return json({ error: "Missing device_id or device_secret." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const tokenHash = await sha256Hex(deviceSecret);
    const { data: tokenRow } = await serviceClient
      .from("device_tokens")
      .select("id")
      .eq("device_id", deviceId)
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (!tokenRow) {
      // Do not leak whether the device_id exists - respond the same way either way.
      return json({ revoked: true });
    }

    await serviceClient.from("device_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", tokenRow.id);
    await serviceClient.from("devices").update({ status: "revoked" }).eq("id", deviceId);
    await serviceClient.from("device_events").insert({ device_id: deviceId, event_type: "revoked" });
    await serviceClient.from("audit_logs").insert({
      actor_type: "device",
      actor_id: deviceId,
      action: "device_revoked",
    });

    return json({ revoked: true });
  } catch (err) {
    console.error("device-revoke error", err);
    return json({ error: "Internal error." }, 500);
  }
});

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
