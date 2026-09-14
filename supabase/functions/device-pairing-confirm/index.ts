// supabase/functions/device-pairing-confirm/index.ts
//
// Called by the Windows Desktop Agent with the 6-digit pairing code shown in the UI.
// No user login session is required here — the security boundary is the short-lived,
// single-use pairing code created by an authorized branch administrator.
//
// On success:
//   - Creates the desktop_agents record.
//   - Generates a cryptographically secure 32-byte / 256-bit raw token.
//   - Persists ONLY the SHA-256 hash in desktop_agent_tokens (raw token is never stored or logged).
//   - Marks the pairing request confirmed and records a 'paired' event.
//   - Returns the raw token to the Desktop Agent exactly once.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, json } from "../_shared/cors.ts";
import { sha256Hex, generateRawToken, mintAgentJwt, ACCESS_TOKEN_TTL_SECONDS } from "../_shared/crypto.ts";

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

export async function handleDevicePairingConfirm(req: Request): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405);
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ error: "Invalid JSON request body." }, 400);
    }

    const pairingCode = typeof body.pairing_code === "string" ? body.pairing_code.trim() : "";
    if (!/^\d{6}$/.test(pairingCode)) {
      return json({ error: "Pairing code must be exactly 6 digits." }, 400);
    }

    const agentName = typeof body.agent_name === "string" && body.agent_name.trim()
      ? body.agent_name.trim().slice(0, 100)
      : "Desktop Agent";
    const hostname = typeof body.hostname === "string" && body.hostname.trim()
      ? body.hostname.trim().slice(0, 255)
      : null;
    const osVersion = typeof body.os_version === "string" && body.os_version.trim()
      ? body.os_version.trim().slice(0, 255)
      : null;
    const appVersion = typeof body.app_version === "string" && body.app_version.trim()
      ? body.app_version.trim().slice(0, 100)
      : null;

    const supabaseUrl = getEnv("SUPABASE_URL");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Server misconfiguration: missing Supabase credentials." }, 500);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    // 1. Find the pairing request by code
    const { data: requestRow, error: findError } = await serviceClient
      .from("desktop_agent_pairing_requests")
      .select("id, branch_id, created_by, expires_at, confirmed_at")
      .eq("pairing_code", pairingCode)
      .maybeSingle();

    if (findError) {
      console.error("Error looking up pairing code:", findError);
      return json({ error: "Database error during pairing lookup." }, 500);
    }

    if (!requestRow) {
      return json({ error: "Invalid pairing code. Please check the code and try again." }, 404);
    }

    if (requestRow.confirmed_at) {
      return json({ error: "This pairing code has already been confirmed and used." }, 409);
    }

    const now = new Date();
    if (new Date(requestRow.expires_at).getTime() <= now.getTime()) {
      return json({ error: "This pairing code has expired. Please generate a new code." }, 410);
    }

    // 2. Race-condition prevention:
    // Atomically claim the pairing request using a conditional update.
    // In PostgreSQL, UPDATE acquires an exclusive row-level lock.
    // If two concurrent requests submit the same code, only one will succeed; the other sees confirmed_at IS NOT NULL.
    const claimTimeIso = now.toISOString();
    const { data: claimedRow, error: claimError } = await serviceClient
      .from("desktop_agent_pairing_requests")
      .update({ confirmed_at: claimTimeIso })
      .eq("id", requestRow.id)
      .is("confirmed_at", null)
      .gt("expires_at", claimTimeIso)
      .select("id, branch_id, created_by")
      .maybeSingle();

    if (claimError || !claimedRow) {
      return json({ error: "Pairing code conflict: code is already confirmed or has just expired." }, 409);
    }

    // 3. Pairing sequence with compensating rollback
    let createdAgentId: string | null = null;
    try {
      // Step A: Create desktop_agents record
      const { data: agent, error: agentError } = await serviceClient
        .from("desktop_agents")
        .insert({
          branch_id: claimedRow.branch_id,
          agent_name: agentName,
          hostname,
          os_version: osVersion,
          app_version: appVersion,
          status: "active",
          paired_by: claimedRow.created_by,
        })
        .select("id")
        .single();

      if (agentError || !agent) {
        throw new Error(`Failed to create desktop_agents record: ${agentError?.message}`);
      }
      createdAgentId = agent.id;

      // Step B: Generate cryptographically secure 32-byte (256-bit) raw token
      const rawToken = generateRawToken(32);
      const tokenHash = await sha256Hex(rawToken);

      const expiresAtDate = new Date(Date.now() + TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000);
      const tokenExpiresAt = expiresAtDate.toISOString();

      // Step C: Store ONLY the token hash (raw token is never persisted in Supabase)
      const { error: tokenError } = await serviceClient
        .from("desktop_agent_tokens")
        .insert({
          desktop_agent_id: createdAgentId,
          token_hash: tokenHash,
          created_via: "pairing",
          expires_at: tokenExpiresAt,
        });

      if (tokenError) {
        throw new Error(`Failed to insert desktop_agent_tokens: ${tokenError.message}`);
      }

      // Step D: Link confirmed_desktop_agent_id on the pairing request
      const { error: updateRequestError } = await serviceClient
        .from("desktop_agent_pairing_requests")
        .update({ confirmed_desktop_agent_id: createdAgentId })
        .eq("id", claimedRow.id);

      if (updateRequestError) {
        throw new Error(`Failed to update pairing request confirmation: ${updateRequestError.message}`);
      }

      // Step E: Emit 'paired' lifecycle audit event
      await serviceClient.from("desktop_agent_events").insert({
        desktop_agent_id: createdAgentId,
        event_type: "paired",
        detail: {
          hostname,
          os_version: osVersion,
          app_version: appVersion,
          branch_id: claimedRow.branch_id,
        },
      });

      // Step F: Mint short-lived Supabase JWT for direct PostgREST & Realtime access
      const jwtSecret = getJwtSecret();
      if (!jwtSecret) {
        throw new Error("Server misconfiguration: missing JWT signing secret.");
      }

      const jwtResult = await mintAgentJwt(
        { id: createdAgentId, branch_id: claimedRow.branch_id },
        jwtSecret,
        ACCESS_TOKEN_TTL_SECONDS
      );

      // Log success WITHOUT logging the raw token, token hash, or JWT
      console.log(`Desktop agent paired successfully. AgentId=${createdAgentId}, BranchId=${claimedRow.branch_id}`);

      // Return raw token exactly once to the Desktop Agent along with the initial short-lived Supabase JWT
      return json({
        desktop_agent_id: createdAgentId,
        branch_id: claimedRow.branch_id,
        agent_token: rawToken,
        access_token: jwtResult.access_token,
        expires_in: jwtResult.expires_in,
        expires_at: tokenExpiresAt,
      });
    } catch (sequenceError) {
      console.error("Pairing confirmation sequence failed. Executing compensating rollback:", sequenceError);

      // Compensating rollback:
      // 1. Delete created agent (foreign key CASCADE removes tokens and events)
      if (createdAgentId) {
        try {
          await serviceClient.from("desktop_agents").delete().eq("id", createdAgentId);
        } catch (cleanupErr) {
          console.error("Compensating rollback: Failed to delete agent record:", cleanupErr);
        }
      }

      // 2. Revert pairing request claim so it is not permanently locked
      try {
        await serviceClient
          .from("desktop_agent_pairing_requests")
          .update({ confirmed_at: null, confirmed_desktop_agent_id: null })
          .eq("id", claimedRow.id);
      } catch (cleanupErr) {
        console.error("Compensating rollback: Failed to release pairing request claim:", cleanupErr);
      }

      return json({ error: "Failed to confirm pairing due to an internal error. Please retry." }, 500);
    }
  } catch (err) {
    console.error("Unexpected error in device-pairing-confirm:", err);
    return json({ error: "Internal server error." }, 500);
  }
}

// Serve with Deno if in Deno runtime
if (typeof Deno !== "undefined" && Deno.serve) {
  Deno.serve(handleDevicePairingConfirm);
}
