// supabase/functions/_shared/auth.ts

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sha256Hex } from "./crypto.ts";

export interface AuthenticatedUser {
  id: string;
  email?: string;
}

export interface AuthenticatedAgent {
  id: string;
  branch_id: string;
  agent_name: string;
  status: string;
  tokenId: string;
}

/**
 * Verifies caller's Supabase Auth user JWT.
 */
export async function verifyUserSession(
  callerClient: SupabaseClient
): Promise<AuthenticatedUser | null> {
  const { data, error } = await callerClient.auth.getUser();
  if (error || !data?.user) {
    return null;
  }
  return {
    id: data.user.id,
    email: data.user.email,
  };
}

/**
 * Checks if the user is a platform admin using public.is_admin().
 */
export async function isPlatformAdmin(
  callerClient: SupabaseClient
): Promise<boolean> {
  try {
    const { data, error } = await callerClient.rpc("is_admin");
    if (!error && data === true) {
      return true;
    }
  } catch {
    // If rpc fails or does not exist, fallback to false
  }
  return false;
}

/**
 * Verifies if a user is authorized for a specific branch.
 * Matches the production RLS logic:
 *   1. is_admin()
 *   2. branches.owner_id = uid OR branches.manager_id = uid
 *   3. user_roles with role IN ('branch', 'branch_owner') for branch_id
 */
export async function verifyBranchAuthorization(
  serviceClient: SupabaseClient,
  callerClient: SupabaseClient,
  userId: string,
  branchId: string
): Promise<boolean> {
  if (await isPlatformAdmin(callerClient)) {
    return true;
  }

  // Check branch ownership / management
  const { data: branch, error: branchErr } = await serviceClient
    .from("branches")
    .select("id, owner_id, manager_id")
    .eq("id", branchId)
    .maybeSingle();

  if (!branchErr && branch) {
    if (branch.owner_id === userId || branch.manager_id === userId) {
      return true;
    }
  }

  // Check user_roles table
  const { data: roleRow, error: roleErr } = await serviceClient
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("branch_id", branchId)
    .in("role", ["branch", "branch_owner", "shop_owner"])
    .maybeSingle();

  if (!roleErr && roleRow) {
    return true;
  }

  return false;
}

/**
 * Resolves a default branch for a user if not explicitly supplied.
 */
export async function resolveUserBranch(
  serviceClient: SupabaseClient,
  userId: string
): Promise<string | null> {
  // 1. Check branches where user is owner or manager
  const { data: ownedBranches } = await serviceClient
    .from("branches")
    .select("id")
    .or(`owner_id.eq.${userId},manager_id.eq.${userId}`)
    .limit(1);

  if (ownedBranches && ownedBranches.length > 0) {
    return ownedBranches[0].id;
  }

  // 2. Check user_roles
  const { data: userRoles } = await serviceClient
    .from("user_roles")
    .select("branch_id")
    .eq("user_id", userId)
    .in("role", ["branch", "branch_owner", "shop_owner"])
    .limit(1);

  if (userRoles && userRoles.length > 0) {
    return userRoles[0].branch_id;
  }

  return null;
}

const getEnv = (key: string): string => {
  if (typeof Deno !== "undefined" && Deno.env) {
    return Deno.env.get(key) || "";
  }
  return (typeof process !== "undefined" && process.env ? process.env[key] : "") || "";
};

/**
 * Extracts bearer token from Authorization header or body.
 */
export function extractBearerToken(req: Request, body?: any): string | null {
  const authHeader = req.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    // Do not confuse anon key with an agent token
    const anonKey = getEnv("SUPABASE_ANON_KEY");
    if (token && token !== anonKey) {
      return token;
    }
  }

  if (body && typeof body.agent_token === "string" && body.agent_token.trim()) {
    return body.agent_token.trim();
  }

  if (body && typeof body.device_secret === "string" && body.device_secret.trim()) {
    return body.device_secret.trim();
  }

  return null;
}

/**
 * Authenticates a desktop agent using its raw token.
 * Verifies:
 *   - SHA-256 hash exists in desktop_agent_tokens
 *   - revoked_at IS NULL
 *   - expires_at > now()
 *   - desktop_agents.status = 'active'
 */
export async function authenticateAgentToken(
  serviceClient: SupabaseClient,
  rawToken: string
): Promise<{ agent: AuthenticatedAgent; tokenId: string } | null> {
  const tokenHash = await sha256Hex(rawToken);

  const { data: tokenRecord, error: tokenError } = await serviceClient
    .from("desktop_agent_tokens")
    .select("id, desktop_agent_id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (tokenError || !tokenRecord) {
    return null;
  }

  if (tokenRecord.revoked_at) {
    return null;
  }

  if (new Date(tokenRecord.expires_at).getTime() <= Date.now()) {
    return null;
  }

  const { data: agent, error: agentError } = await serviceClient
    .from("desktop_agents")
    .select("id, branch_id, agent_name, status")
    .eq("id", tokenRecord.desktop_agent_id)
    .maybeSingle();

  if (agentError || !agent || agent.status !== "active") {
    return null;
  }

  return {
    agent: {
      id: agent.id,
      branch_id: agent.branch_id,
      agent_name: agent.agent_name,
      status: agent.status,
      tokenId: tokenRecord.id,
    },
    tokenId: tokenRecord.id,
  };
}
