// supabase/functions/_shared/crypto.ts

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateRawToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function generatePairingCode(digits = 6): string {
  const max = Math.pow(10, digits);
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % max;
  return n.toString().padStart(digits, "0");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// Standard short-lived Supabase JWT lifetime (15 minutes by design)
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Creates a standard Supabase-compatible HS256 signed JWT using Web Crypto API.
 * Compatible with Deno Edge Functions, Node.js test runners, and standard runtimes.
 */
export async function createSupabaseJwt(
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, data);
  const signatureB64 = base64UrlEncode(new Uint8Array(signature));

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

export interface MintJwtResult {
  access_token: string;
  expires_in: number;
  expires_at: string;
}

/**
 * Mints a short-lived Supabase JWT carrying agent and branch claims.
 * PostgREST, Realtime, and Storage recognize role: 'authenticated' and evaluate RLS
 * using sub / device_id / desktop_agent_id / branch_id.
 */
export async function mintAgentJwt(
  agent: { id: string; branch_id: string },
  jwtSecret: string,
  ttlSeconds: number = ACCESS_TOKEN_TTL_SECONDS
): Promise<MintJwtResult> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expSeconds = nowSeconds + ttlSeconds;

  const payload = {
    role: "authenticated",
    sub: agent.id,
    device_id: agent.id,
    desktop_agent_id: agent.id,
    branch_id: agent.branch_id,
    iss: "supabase",
    iat: nowSeconds,
    exp: expSeconds,
  };

  const accessToken = await createSupabaseJwt(payload, jwtSecret);
  return {
    access_token: accessToken,
    expires_in: ttlSeconds,
    expires_at: new Date(expSeconds * 1000).toISOString(),
  };
}

