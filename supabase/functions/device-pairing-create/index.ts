// supabase/functions/device-pairing-create/index.ts
//
// Called by an authenticated branch user (owner, manager, staff, or platform admin)
// to generate a short-lived, single-use 6-digit pairing code for connecting a Windows Desktop Agent.
//
// Security boundary: Only authenticated users with authorization over the target branch can create
// pairing requests. Tokens are never created here — only a short-lived pairing request.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, json } from "../_shared/cors.ts";
import { generatePairingCode } from "../_shared/crypto.ts";
import {
  verifyUserSession,
  verifyBranchAuthorization,
  resolveUserBranch,
  isPlatformAdmin,
} from "../_shared/auth.ts";

const PAIRING_CODE_EXPIRY_MINUTES = 10;
const MAX_COLLISION_RETRIES = 5;

const getEnv = (key: string): string => {
  if (typeof Deno !== "undefined" && Deno.env) {
    return Deno.env.get(key) || "";
  }
  return (typeof process !== "undefined" && process.env ? process.env[key] : "") || "";
};

export async function handleDevicePairingCreate(req: Request): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header. Authentication required." }, 401);
    }

    const supabaseUrl = getEnv("SUPABASE_URL");
    const anonKey = getEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Server misconfiguration: missing Supabase environment variables." }, 500);
    }

    // Client bound to caller's JWT to evaluate user identity
    const callerClient = createClient(supabaseUrl, anonKey || serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const user = await verifyUserSession(callerClient);
    if (!user) {
      return json({ error: "Invalid or expired session. Please sign in again." }, 401);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    let targetBranchId: string | null = typeof body?.branch_id === "string" ? body.branch_id.trim() : null;

    if (targetBranchId) {
      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(targetBranchId)) {
        return json({ error: "Invalid branch_id format. Must be a valid UUID." }, 400);
      }

      const isAuthorized = await verifyBranchAuthorization(
        serviceClient,
        callerClient,
        user.id,
        targetBranchId
      );

      if (!isAuthorized) {
        return json({ error: "You are not authorized to create pairing codes for this branch." }, 403);
      }
    } else {
      // Resolve caller's branch if none was provided
      targetBranchId = await resolveUserBranch(serviceClient, user.id);

      if (!targetBranchId) {
        // If user is a platform admin without an assigned branch, require explicit branch_id
        if (await isPlatformAdmin(callerClient)) {
          return json({ error: "Platform admin must supply branch_id explicitly." }, 400);
        }
        return json({ error: "No authorized branch found for your account. Please specify branch_id or complete branch setup." }, 400);
      }
    }

    const expiresAt = new Date(Date.now() + PAIRING_CODE_EXPIRY_MINUTES * 60_000).toISOString();

    // Insert pairing request with collision retry loop
    let createdRecord: { id: string; pairing_code: string; expires_at: string; branch_id: string } | null = null;

    for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
      const code = generatePairingCode(6);

      const { data, error } = await serviceClient
        .from("desktop_agent_pairing_requests")
        .insert({
          branch_id: targetBranchId,
          pairing_code: code,
          created_by: user.id,
          expires_at: expiresAt,
        })
        .select("id, pairing_code, expires_at, branch_id")
        .maybeSingle();

      if (!error && data) {
        createdRecord = data;
        break;
      }

      // Postgres unique constraint violation code is 23505
      if (error && error.code === "23505") {
        continue;
      }

      console.error("Failed to insert pairing request:", error);
      return json({ error: "Could not create pairing request in database." }, 500);
    }

    if (!createdRecord) {
      console.error("Pairing code collision limit exceeded.");
      return json({ error: "Could not generate a unique pairing code. Please try again." }, 500);
    }

    // Return only the exact fields required by frontend
    return json({
      request_id: createdRecord.id,
      pairing_code: createdRecord.pairing_code,
      expires_at: createdRecord.expires_at,
      branch_id: createdRecord.branch_id,
    });
  } catch (err) {
    console.error("Unexpected error in device-pairing-create:", err);
    return json({ error: "Internal server error." }, 500);
  }
}

// Serve with Deno if in Deno runtime
if (typeof Deno !== "undefined" && Deno.serve) {
  Deno.serve(handleDevicePairingCreate);
}
