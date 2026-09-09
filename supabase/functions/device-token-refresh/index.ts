// supabase/functions/device-token-refresh/index.ts
//
// Exchanges the device's long-lived secret (DPAPI-stored on the shop PC) for a
// short-lived JWT carrying a `device_id` custom claim. That JWT is what the C# agent
// attaches to Postgrest/Realtime calls (see SupabaseGateway.AttachDeviceSessionAsync) so
// RLS policies (auth_device_id() in migrations/0002_rls_policies.sql) can scope queries
// to exactly this device's own rows.
//
// IMPORTANT: this signs a JWT using the PROJECT'S OWN JWT secret (the same one
// Supabase uses to sign user session tokens), so Postgrest/Realtime accept it as valid
// without any extra configuration. Set it as an Edge Function secret:
//   supabase secrets set SUPABASE_JWT_SECRET=<value from Project Settings > API > JWT Settings>
// This value is at least as sensitive as service_role - never put it in the desktop app.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // short-lived by design - see ARCHITECTURE.md §7

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

    const { data: device, error: deviceError } = await serviceClient
      .from("devices")
      .select("id, status")
      .eq("id", deviceId)
      .maybeSingle();

    if (deviceError || !device || device.status !== "active") {
      return json({ error: "Device not found or not active." }, 403);
    }

    const tokenHash = await sha256Hex(deviceSecret);
    const { data: tokenRow, error: tokenError } = await serviceClient
      .from("device_tokens")
      .select("id, revoked_at")
      .eq("device_id", deviceId)
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (tokenError || !tokenRow || tokenRow.revoked_at) {
      return json({ error: "Invalid or revoked device credential." }, 401);
    }

    const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
    if (!jwtSecret) {
      console.error("SUPABASE_JWT_SECRET is not configured for this Edge Function.");
      return json({ error: "Server misconfiguration." }, 500);
    }

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(jwtSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const accessToken = await create(
      { alg: "HS256", typ: "JWT" },
      {
        role: "authenticated",
        device_id: deviceId,
        sub: `device:${deviceId}`,
        exp: getNumericDate(ACCESS_TOKEN_TTL_SECONDS),
      },
      key,
    );

    await serviceClient.from("devices").update({ last_seen_at: new Date().toISOString() }).eq("id", deviceId);

    return json({ access_token: accessToken, expires_in: ACCESS_TOKEN_TTL_SECONDS });
  } catch (err) {
    console.error("device-token-refresh error", err);
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
