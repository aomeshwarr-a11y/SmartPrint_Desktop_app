// supabase/functions/device-revoke/index.ts
//
// Revokes a Desktop Agent and all its associated tokens.
// Supported callers:
//   1. Authenticated branch user (owner, manager, staff, platform admin) revoking from UI/dashboard.
//      Strictly enforces that the user has authorization over the agent's branch. Cross-branch
//      revocation is forbidden.
//   2. Agent-initiated unpair using its own bearer token.
//
// Records a 'token_revoked' event in desktop_agent_events.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, json } from "../_shared/cors.ts";
import {
  verifyUserSession,
  verifyBranchAuthorization,
  extractBearerToken,
  authenticateAgentToken,
} from "../_shared/auth.ts";

const getEnv = (key: string): string => {
  if (typeof Deno !== "undefined" && Deno.env) {
    return Deno.env.get(key) || "";
  }
  return (typeof process !== "undefined" && process.env ? process.env[key] : "") || "";
};

export async function handleDeviceRevoke(req: Request): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405);
  }

  try {
    const supabaseUrl = getEnv("SUPABASE_URL");
    const anonKey = getEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Server misconfiguration: missing Supabase credentials." }, 500);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const authHeader = req.headers.get("Authorization");

    let agentIdToRevoke: string | null = null;
    let revokedByUserId: string | null = null;
    let revocationSource: "user" | "agent" = "agent";

    // 1. Check if caller is an authenticated Supabase user (Dashboard / UI revocation)
    if (authHeader) {
      const callerClient = createClient(supabaseUrl, anonKey || serviceRoleKey, {
        global: { headers: { Authorization: authHeader } },
      });

      const user = await verifyUserSession(callerClient);
      if (user) {
        revokedByUserId = user.id;
        revocationSource = "user";

        const requestedAgentId = typeof body?.desktop_agent_id === "string"
          ? body.desktop_agent_id.trim()
          : typeof body?.agent_id === "string"
          ? body.agent_id.trim()
          : null;

        if (!requestedAgentId) {
          return json({ error: "Missing desktop_agent_id in request body." }, 400);
        }

        // Fetch the target agent to inspect its branch
        const { data: targetAgent, error: agentError } = await serviceClient
          .from("desktop_agents")
          .select("id, branch_id, status")
          .eq("id", requestedAgentId)
          .maybeSingle();

        if (agentError || !targetAgent) {
          return json({ error: "Desktop agent not found." }, 404);
        }

        // Verify user has authorization over this agent's branch
        const isAuthorized = await verifyBranchAuthorization(
          serviceClient,
          callerClient,
          user.id,
          targetAgent.branch_id
        );

        if (!isAuthorized) {
          return json({ error: "Forbidden: You are not authorized to revoke agents for this branch." }, 403);
        }

        agentIdToRevoke = targetAgent.id;
      }
    }

    // 2. If not authenticated as a user, check for agent bearer token (Agent self-unpair)
    if (!agentIdToRevoke) {
      const rawToken = extractBearerToken(req, body);
      if (!rawToken) {
        return json({ error: "Authentication required. Provide user session or agent bearer token." }, 401);
      }

      const agentAuth = await authenticateAgentToken(serviceClient, rawToken);
      if (!agentAuth) {
        // Do not leak existence of token; respond cleanly
        return json({ error: "Invalid, expired, or revoked agent token." }, 401);
      }

      agentIdToRevoke = agentAuth.agent.id;
      revocationSource = "agent";
    }

    const nowIso = new Date().toISOString();

    // 3. Revoke all active tokens for this desktop agent
    await serviceClient
      .from("desktop_agent_tokens")
      .update({ revoked_at: nowIso })
      .eq("desktop_agent_id", agentIdToRevoke)
      .is("revoked_at", null);

    // 4. Mark desktop agent status as revoked
    const updatePayload: Record<string, any> = {
      status: "revoked",
      revoked_at: nowIso,
    };
    if (revokedByUserId) {
      updatePayload.revoked_by = revokedByUserId;
    }

    const { error: updateAgentError } = await serviceClient
      .from("desktop_agents")
      .update(updatePayload)
      .eq("id", agentIdToRevoke);

    if (updateAgentError) {
      console.error("Failed to update desktop agent revocation state:", updateAgentError);
      return json({ error: "Database error during agent revocation." }, 500);
    }

    // 5. Unlink any printers previously assigned to this agent (set desktop_agent_id = NULL)
    await serviceClient
      .from("printers")
      .update({ desktop_agent_id: null })
      .eq("desktop_agent_id", agentIdToRevoke);

    // 6. Record 'token_revoked' audit lifecycle event
    await serviceClient.from("desktop_agent_events").insert({
      desktop_agent_id: agentIdToRevoke,
      event_type: "token_revoked",
      detail: {
        revoked_by: revokedByUserId,
        actor: revocationSource,
        revoked_at: nowIso,
      },
    });

    console.log(`Desktop agent ${agentIdToRevoke} revoked by ${revocationSource}`);

    return json({
      revoked: true,
      desktop_agent_id: agentIdToRevoke,
    });
  } catch (err) {
    console.error("Unexpected error in device-revoke:", err);
    return json({ error: "Internal server error." }, 500);
  }
}

// Serve with Deno if in Deno runtime
if (typeof Deno !== "undefined" && Deno.serve) {
  Deno.serve(handleDeviceRevoke);
}
