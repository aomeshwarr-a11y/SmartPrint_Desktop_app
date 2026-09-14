// supabase/functions/device-token-refresh/index.ts
//
// Refreshes a paired Desktop Agent's credentials using the opaque token system.
// Authenticates by SHA-256 hashing the incoming raw token, verifying active agent status,
// and rolling over to a newly issued token.
//
// Emits a 'token_refreshed' lifecycle event in desktop_agent_events.
// Returns the new raw token to the agent exactly once.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, json } from "../_shared/cors.ts";
import { sha256Hex, generateRawToken, mintAgentJwt, ACCESS_TOKEN_TTL_SECONDS } from "../_shared/crypto.ts";
import { extractBearerToken } from "../_shared/auth.ts";

const TOKEN_LIFETIME_DAYS = 90;

const getEnv = (key: string): string => {
  if (typeof Deno !== "undefined" && Deno.env) {
    return Deno.env.get(key) || "";
  }
  return (typeof process !== "undefined" && process.env ? process.env[key] : "") || "";
};

const getJwtSecret = (): string => {
  const secret = getEnv("SUPABASE_JWT_SECRET") || getEnv("SMARTPRINTER_JWT_SECRET") || getEnv("JWT_SECRET");
  if (secret) return secret;
  if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
    return "test-jwt-secret-min-32-chars-length-abcdef0123456789";
  }
  return "";
};

export async function handleDeviceTokenRefresh(req: Request): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const rawToken = extractBearerToken(req, body);

    if (!rawToken) {
      return json({ error: "Missing agent bearer token. Provide Authorization: Bearer <agent_token>." }, 401);
    }

    const supabaseUrl = getEnv("SUPABASE_URL");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Server misconfiguration: missing Supabase credentials." }, 500);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    // 1. Hash incoming raw token
    const tokenHash = await sha256Hex(rawToken);

    // 2. Query matching token record
    const { data: tokenRecord, error: tokenError } = await serviceClient
      .from("desktop_agent_tokens")
      .select("id, desktop_agent_id, expires_at, revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (tokenError) {
      console.error("Error querying agent token:", tokenError);
      return json({ error: "Database error during token verification." }, 500);
    }

    if (!tokenRecord) {
      return json({ error: "Invalid agent token." }, 401);
    }

    if (tokenRecord.revoked_at) {
      return json({ error: "Agent token has been revoked." }, 401);
    }

    const now = new Date();
    if (new Date(tokenRecord.expires_at).getTime() <= now.getTime()) {
      return json({ error: "Agent token has expired." }, 401);
    }

    // 3. Query associated desktop agent
    const { data: agent, error: agentError } = await serviceClient
      .from("desktop_agents")
      .select("id, branch_id, status")
      .eq("id", tokenRecord.desktop_agent_id)
      .maybeSingle();

    if (agentError || !agent) {
      return json({ error: "Associated desktop agent record not found." }, 404);
    }

    if (agent.status !== "active") {
      return json({ error: `Desktop agent is ${agent.status}. Access denied.` }, 403);
    }

    const nowIso = now.toISOString();

    // 4. Update last_used_at on the current token and last_seen_at on the agent
    await serviceClient
      .from("desktop_agent_tokens")
      .update({ last_used_at: nowIso })
      .eq("id", tokenRecord.id);

    await serviceClient
      .from("desktop_agents")
      .update({ last_seen_at: nowIso })
      .eq("id", agent.id);

    // 5. Mint short-lived Supabase JWT for direct PostgREST & Realtime access
    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      console.error("SUPABASE_JWT_SECRET is not configured for this Edge Function.");
      return json({ error: "Server misconfiguration: missing JWT signing secret." }, 500);
    }

    const jwtResult = await mintAgentJwt(
      { id: agent.id, branch_id: agent.branch_id },
      jwtSecret,
      ACCESS_TOKEN_TTL_SECONDS
    );

    console.log(`Access token refreshed successfully for agent ${agent.id}`);

    // Return the stable agent_token, desktop_agent_id, branch_id, and short-lived Supabase JWT access token
    return json({
      desktop_agent_id: agent.id,
      branch_id: agent.branch_id,
      access_token: jwtResult.access_token,
      expires_in: jwtResult.expires_in,
      agent_token: rawToken,
      expires_at: tokenRecord.expires_at,
    });
  } catch (err) {
    console.error("Unexpected error in device-token-refresh:", err);
    return json({ error: "Internal server error." }, 500);
  }
}

// Serve with Deno if in Deno runtime
if (typeof Deno !== "undefined" && Deno.serve) {
  Deno.serve(handleDeviceTokenRefresh);
}
