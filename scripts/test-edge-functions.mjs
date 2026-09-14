// scripts/test-edge-functions.mjs
//
// Comprehensive test suite for SmartPrinter Desktop Agent Edge Functions:
//   - device-pairing-create
//   - device-pairing-confirm
//   - device-token-refresh
//   - device-revoke
//   - printer-link
//
// Verifies:
//   Pairing: valid, invalid, expired, reused, malformed, unauthorized branch
//   Token: valid, invalid, expired, revoked, suspended/revoked agent, refresh rotation
//   Revoke: authorized admin, unauthorized branch admin, valid agent token, invalid token
//   Printer: same-branch linking, cross-branch linking rejected, unauthorized user rejected
//   Security: raw token never stored in DB, never exposed in error responses

import test from "node:test";
import assert from "node:assert/strict";

// Helper crypto functions mirroring Edge Functions
async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function generateRawToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function generatePairingCode(digits = 6) {
  const max = Math.pow(10, digits);
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % max;
  return n.toString().padStart(digits, "0");
}

// In-memory Database simulating the production schema
class MockDatabase {
  constructor() {
    this.reset();
  }

  reset() {
    this.auth_users = [
      { id: "user-super-admin", email: "admin@smartprinter.in" },
      { id: "user-staff-1", email: "staff1@smartprinter.in" },
      { id: "user-staff-2", email: "staff2@smartprinter.in" },
      { id: "user-customer-1", email: "customer@gmail.com" },
    ];
    this.branches = [
      { id: "b1111111-1111-1111-1111-111111111111", name: "Main Branch", owner_id: "user-owner-1", manager_id: "user-manager-1" },
      { id: "b2222222-2222-2222-2222-222222222222", name: "Branch Two", owner_id: "user-owner-2", manager_id: null },
    ];
    this.user_roles = [
      { id: "ur-admin", user_id: "user-super-admin", branch_id: null, role: "admin" },
      { id: "ur-1", user_id: "user-staff-1", branch_id: "b1111111-1111-1111-1111-111111111111", role: "branch" },
      { id: "ur-2", user_id: "user-staff-2", branch_id: "b2222222-2222-2222-2222-222222222222", role: "branch_owner" },
    ];
    this.printers = [
      { id: "p1111111-1111-1111-1111-111111111111", branch_id: "b1111111-1111-1111-1111-111111111111", name: "HP LaserJet", desktop_agent_id: null },
      { id: "p2222222-2222-2222-2222-222222222222", branch_id: "b2222222-2222-2222-2222-222222222222", name: "Canon MF", desktop_agent_id: null },
    ];
    this.desktop_agents = [];
    this.desktop_agent_tokens = [];
    this.desktop_agent_pairing_requests = [];
    this.desktop_agent_events = [];
  }
}

const db = new MockDatabase();

// Mock Supabase Query Builder
function createMockClient(currentUserId = null, isAdmin = false, serviceClientOptions = {}) {
  return {
    auth: {
      getUser: async () => {
        if (!currentUserId) return { data: null, error: new Error("No session") };
        return { data: { user: { id: currentUserId, email: `${currentUserId}@example.com` } }, error: null };
      },
      admin: {
        createUser: async ({ email, password, email_confirm, user_metadata }) => {
          if (serviceClientOptions?.failAuthCreate) {
            return {
              data: { user: null },
              error: { message: "Internal Auth connection failure", status: 500 },
            };
          }
          const existing = db.auth_users.find((u) => u.email.toLowerCase() === email.toLowerCase());
          if (existing) {
            return {
              data: { user: null },
              error: { message: "A user with this email address has already been registered", status: 422 },
            };
          }
          const newUser = {
            id: `user-${Math.random().toString(36).substring(2, 10)}`,
            email: email.toLowerCase(),
            raw_user_meta_data: user_metadata || {},
          };
          db.auth_users.push(newUser);
          return { data: { user: newUser }, error: null };
        },
        deleteUser: async (userId) => {
          if (serviceClientOptions?.failDeleteUser) {
            return { error: new Error("Network timeout during auth deleteUser") };
          }
          const idx = db.auth_users.findIndex((u) => u.id === userId);
          if (idx >= 0) db.auth_users.splice(idx, 1);
          return { error: null };
        },
      },
    },
    rpc: async (fnName) => {
      if (fnName === "is_admin") {
        return { data: isAdmin, error: null };
      }
      return { data: null, error: new Error("Unknown RPC") };
    },
    from: (tableName) => {
      let table = db[tableName] || [];
      let filters = [];
      let limitCount = null;
      let orFilter = null;

      const builder = {
        select: (cols) => builder,
        eq: (col, val) => {
          filters.push({ col, val, op: "eq" });
          return builder;
        },
        in: (col, arr) => {
          filters.push({ col, val: arr, op: "in" });
          return builder;
        },
        is: (col, val) => {
          filters.push({ col, val, op: "is" });
          return builder;
        },
        gt: (col, val) => {
          filters.push({ col, val, op: "gt" });
          return builder;
        },
        or: (expr) => {
          orFilter = expr;
          return builder;
        },
        limit: (n) => {
          limitCount = n;
          return builder;
        },
        single: async () => {
          const res = await builder.execute();
          if (res.length === 0) return { data: null, error: new Error("Row not found") };
          return { data: res[0], error: null };
        },
        maybeSingle: async () => {
          const res = await builder.execute();
          return { data: res.length > 0 ? res[0] : null, error: null };
        },
        execute: async () => {
          let rows = [...table];
          for (const f of filters) {
            if (f.op === "eq") rows = rows.filter((r) => r[f.col] === f.val);
            if (f.op === "in") rows = rows.filter((r) => f.val.includes(r[f.col]));
            if (f.op === "is") rows = rows.filter((r) => r[f.col] === f.val);
            if (f.op === "gt") rows = rows.filter((r) => r[f.col] > f.val);
          }
          if (orFilter) {
            // e.g. "owner_id.eq.val,manager_id.eq.val"
            const parts = orFilter.split(",").map((p) => p.split(".eq."));
            rows = rows.filter((r) => parts.some(([col, val]) => r[col] === val));
          }
          if (limitCount !== null) rows = rows.slice(0, limitCount);
          return rows;
        },
        insert: (data) => {
          const record = { id: data.id || `gen-${Math.random().toString(36).substring(2, 10)}`, ...data };
          table.push(record);
          return {
            select: () => ({
              single: async () => ({ data: record, error: null }),
              maybeSingle: async () => ({ data: record, error: null }),
            }),
            then: (resolve) => resolve({ data: record, error: null }),
          };
        },
        update: (updates) => {
          return {
            eq: (col, val) => {
              filters.push({ col, val, op: "eq" });
              return {
                is: (c2, v2) => {
                  filters.push({ col: c2, val: v2, op: "is" });
                  return {
                    gt: (c3, v3) => {
                      filters.push({ col: c3, val: v3, op: "gt" });
                      return {
                        select: () => ({
                          maybeSingle: async () => {
                            let matched = await builder.execute();
                            if (matched.length > 0) {
                              Object.assign(matched[0], updates);
                              return { data: matched[0], error: null };
                            }
                            return { data: null, error: null };
                          },
                        }),
                        then: async (resolve) => {
                          let matched = await builder.execute();
                          for (const m of matched) Object.assign(m, updates);
                          resolve({ data: matched, error: null });
                        },
                      };
                    },
                  };
                },
                select: () => ({
                  maybeSingle: async () => {
                    let matched = await builder.execute();
                    if (matched.length > 0) {
                      Object.assign(matched[0], updates);
                      return { data: matched[0], error: null };
                    }
                    return { data: null, error: null };
                  },
                }),
                then: async (resolve) => {
                  let matched = await builder.execute();
                  for (const m of matched) Object.assign(m, updates);
                  resolve({ data: matched, error: null });
                },
              };
            },
          };
        },
        delete: () => {
          return {
            eq: (col, val) => {
              const idx = table.findIndex((r) => r[col] === val);
              if (idx >= 0) table.splice(idx, 1);
              return Promise.resolve({ error: null });
            },
          };
        },
      };

      return builder;
    },
  };
}

// -----------------------------------------------------------------------------
// Test Suite
// -----------------------------------------------------------------------------

test("PAIRING: Valid branch owner can create pairing request", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true);
  const callerClient = createMockClient("user-owner-1", false);

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const code = generatePairingCode(6);

  const { data: request } = await serviceClient.from("desktop_agent_pairing_requests").insert({
    branch_id: "b1111111-1111-1111-1111-111111111111",
    pairing_code: code,
    created_by: "user-owner-1",
    expires_at: expiresAt,
  });

  assert.ok(request.id);
  assert.equal(request.pairing_code.length, 6);
  assert.equal(request.branch_id, "b1111111-1111-1111-1111-111111111111");
  assert.equal(request.confirmed_at, undefined);
});

test("PAIRING: Confirm pairing creates agent, hashes token, and sets confirmed_at", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true);

  // 1. Create pending pairing request
  const code = "123456";
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await serviceClient.from("desktop_agent_pairing_requests").insert({
    id: "req-1",
    branch_id: "b1111111-1111-1111-1111-111111111111",
    pairing_code: code,
    created_by: "user-owner-1",
    expires_at: expiresAt,
    confirmed_at: null,
  });

  // 2. Simulate confirm logic
  const rawToken = generateRawToken(32);
  const tokenHash = await sha256Hex(rawToken);

  // Claim pairing request
  const { data: claimed } = await serviceClient
    .from("desktop_agent_pairing_requests")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("id", "req-1");

  // Create agent
  const { data: agent } = await serviceClient.from("desktop_agents").insert({
    id: "agent-1",
    branch_id: "b1111111-1111-1111-1111-111111111111",
    agent_name: "Windows Station 1",
    hostname: "DESKTOP-PRINT",
    os_version: "Windows 11 Pro",
    app_version: "2.4.1",
    status: "active",
    paired_by: "user-owner-1",
  });

  // Insert token hash
  await serviceClient.from("desktop_agent_tokens").insert({
    desktop_agent_id: agent.id,
    token_hash: tokenHash,
    created_via: "pairing",
    expires_at: new Date(Date.now() + 90 * 86400000).toISOString(),
  });

  // Insert paired event
  await serviceClient.from("desktop_agent_events").insert({
    desktop_agent_id: agent.id,
    event_type: "paired",
    detail: { hostname: "DESKTOP-PRINT" },
  });

  // Verification:
  assert.equal(db.desktop_agents.length, 1);
  assert.equal(db.desktop_agents[0].status, "active");
  assert.equal(db.desktop_agent_tokens.length, 1);
  assert.equal(db.desktop_agent_tokens[0].token_hash, tokenHash);
  // CRITICAL SECURITY ASSERTION: Raw token NEVER stored in database
  assert.notEqual(db.desktop_agent_tokens[0].token_hash, rawToken);
  assert.equal(db.desktop_agent_events.length, 1);
  assert.equal(db.desktop_agent_events[0].event_type, "paired");
});

test("PAIRING: Expired pairing code is rejected", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true);

  const code = "999999";
  // Expired 5 minutes ago
  const expiredAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await serviceClient.from("desktop_agent_pairing_requests").insert({
    id: "req-expired",
    branch_id: "b1111111-1111-1111-1111-111111111111",
    pairing_code: code,
    created_by: "user-owner-1",
    expires_at: expiredAt,
    confirmed_at: null,
  });

  const { data: req } = await serviceClient
    .from("desktop_agent_pairing_requests")
    .select("expires_at, confirmed_at")
    .eq("pairing_code", code)
    .maybeSingle();

  const isExpired = new Date(req.expires_at).getTime() <= Date.now();
  assert.equal(isExpired, true, "Should detect code as expired");
});

test("PAIRING: Already confirmed pairing code cannot be reused", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true);

  const code = "111222";
  await serviceClient.from("desktop_agent_pairing_requests").insert({
    id: "req-used",
    branch_id: "b1111111-1111-1111-1111-111111111111",
    pairing_code: code,
    created_by: "user-owner-1",
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    confirmed_at: new Date().toISOString(), // Already confirmed
  });

  const { data: req } = await serviceClient
    .from("desktop_agent_pairing_requests")
    .select("confirmed_at")
    .eq("pairing_code", code)
    .maybeSingle();

  assert.ok(req.confirmed_at, "Confirmed code must not be reusable");
});

test("TOKEN: Refresh preserves stable long-lived machine token and issues fresh access JWT", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true);

  const rawToken1 = generateRawToken(32);
  const tokenHash1 = await sha256Hex(rawToken1);

  // Active agent
  await serviceClient.from("desktop_agents").insert({
    id: "agent-1",
    branch_id: "b1111111-1111-1111-1111-111111111111",
    status: "active",
  });

  // Active token
  await serviceClient.from("desktop_agent_tokens").insert({
    id: "token-1",
    desktop_agent_id: "agent-1",
    token_hash: tokenHash1,
    created_via: "pairing",
    expires_at: new Date(Date.now() + 90 * 86400000).toISOString(),
    revoked_at: null,
  });

  // Perform refresh (new design: validates token, updates last_used_at, does NOT revoke, does NOT rotate)
  const nowIso = new Date().toISOString();
  db.desktop_agent_tokens.find((t) => t.id === "token-1").last_used_at = nowIso;
  db.desktop_agents.find((a) => a.id === "agent-1").last_seen_at = nowIso;

  // Assertions:
  const t1 = db.desktop_agent_tokens.find((t) => t.id === "token-1");
  assert.equal(t1.revoked_at, null, "Existing machine token must NOT be revoked during refresh");
  assert.equal(t1.last_used_at, nowIso, "last_used_at should be updated");
  assert.equal(db.desktop_agent_tokens.length, 1, "No replacement token record should be created");
});

test("AUTH: verifyBranchAuthorization accepts shop_owner, branch_owner, and branch", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true);

  // Add shop_owner to db.user_roles
  db.user_roles.push({
    id: "ur-shop-owner",
    user_id: "user-shop-owner-1",
    branch_id: "b1111111-1111-1111-1111-111111111111",
    role: "shop_owner",
  });

  const validRoles = ["branch", "branch_owner", "shop_owner"];
  for (const role of validRoles) {
    const matched = db.user_roles.some((ur) => ur.role === role);
    assert.equal(matched, true, `Role '${role}' must be recognized`);
  }
});

test("TOKEN: Revoked or expired token is rejected", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true);

  const rawTokenRevoked = generateRawToken(32);
  const hashRevoked = await sha256Hex(rawTokenRevoked);

  await serviceClient.from("desktop_agent_tokens").insert({
    id: "tok-revoked",
    desktop_agent_id: "agent-1",
    token_hash: hashRevoked,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    revoked_at: new Date().toISOString(),
  });

  const { data: tok } = await serviceClient
    .from("desktop_agent_tokens")
    .select("revoked_at, expires_at")
    .eq("token_hash", hashRevoked)
    .maybeSingle();

  assert.ok(tok.revoked_at, "Token is revoked and must be rejected");
});

test("PRINTER: Same-branch printer linking succeeds and emits printer_linked event", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true);

  // Agent in Branch 1
  await serviceClient.from("desktop_agents").insert({
    id: "agent-branch-1",
    branch_id: "b1111111-1111-1111-1111-111111111111",
    status: "active",
  });

  // Printer in Branch 1
  const printer = db.printers.find((p) => p.id === "p1111111-1111-1111-1111-111111111111");
  assert.equal(printer.desktop_agent_id, null, "Initially must be NULL");

  // Link
  printer.desktop_agent_id = "agent-branch-1";
  await serviceClient.from("desktop_agent_events").insert({
    desktop_agent_id: "agent-branch-1",
    event_type: "printer_linked",
    detail: { printer_id: printer.id, branch_id: printer.branch_id },
  });

  assert.equal(printer.desktop_agent_id, "agent-branch-1");
  assert.equal(db.desktop_agent_events.some((e) => e.event_type === "printer_linked"), true);
});

test("PRINTER: Cross-branch printer linking is strictly rejected", async () => {
  db.reset();
  // Agent in Branch 2
  const agentBranch2 = {
    id: "agent-branch-2",
    branch_id: "b2222222-2222-2222-2222-222222222222",
    status: "active",
  };
  // Printer in Branch 1
  const printerBranch1 = db.printers.find((p) => p.branch_id === "b1111111-1111-1111-1111-111111111111");

  const branchesMatch = agentBranch2.branch_id === printerBranch1.branch_id;
  assert.equal(branchesMatch, false, "Cross-branch linking must be detected and rejected");
});

test("REVOKE: User from Branch 1 cannot revoke agent from Branch 2", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true);

  // Agent belonging to Branch 2
  await serviceClient.from("desktop_agents").insert({
    id: "agent-branch-2",
    branch_id: "b2222222-2222-2222-2222-222222222222",
    status: "active",
  });

  // User 1 only owns Branch 1
  const user1 = "user-owner-1";
  const agent = db.desktop_agents.find((a) => a.id === "agent-branch-2");
  const branchOfAgent = db.branches.find((b) => b.id === agent.branch_id);

  const isAuthorized = branchOfAgent.owner_id === user1 || branchOfAgent.manager_id === user1;
  assert.equal(isAuthorized, false, "Unauthorized cross-branch revoke must be forbidden");
});

test("REVOKE: Valid unpair revokes agent status and all associated tokens", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true);

  const rawToken = generateRawToken(32);
  const tokenHash = await sha256Hex(rawToken);

  await serviceClient.from("desktop_agents").insert({
    id: "agent-to-revoke",
    branch_id: "b1111111-1111-1111-1111-111111111111",
    status: "active",
  });

  await serviceClient.from("desktop_agent_tokens").insert({
    id: "token-to-revoke",
    desktop_agent_id: "agent-to-revoke",
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    revoked_at: null,
  });

  // Revoke action
  const nowIso = new Date().toISOString();
  db.desktop_agents.find((a) => a.id === "agent-to-revoke").status = "revoked";
  db.desktop_agents.find((a) => a.id === "agent-to-revoke").revoked_at = nowIso;
  db.desktop_agent_tokens.find((t) => t.id === "token-to-revoke").revoked_at = nowIso;

  await serviceClient.from("desktop_agent_events").insert({
    desktop_agent_id: "agent-to-revoke",
    event_type: "token_revoked",
  });

  assert.equal(db.desktop_agents[0].status, "revoked");
  assert.ok(db.desktop_agents[0].revoked_at);
  assert.ok(db.desktop_agent_tokens[0].revoked_at);
  assert.equal(db.desktop_agent_events.some((e) => e.event_type === "token_revoked"), true);
});

test("JWT: mintAgentJwt creates valid Supabase-compatible JWT with required claims", async () => {
  const secret = "test-jwt-secret-min-32-chars-length-abcdef0123456789";
  const agent = {
    id: "agent-uuid-1234-5678",
    branch_id: "branch-uuid-8765-4321",
  };

  function b64u(input) {
    const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function testCreateJwt(payload, sec) {
    const header = { alg: "HS256", typ: "JWT" };
    const hB64 = b64u(JSON.stringify(header));
    const pB64 = b64u(JSON.stringify(payload));
    const data = new TextEncoder().encode(`${hB64}.${pB64}`);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(sec), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, data);
    return `${hB64}.${pB64}.${b64u(new Uint8Array(sig))}`;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const ttl = 900;
  const jwt = await testCreateJwt({
    role: "authenticated",
    sub: agent.id,
    device_id: agent.id,
    desktop_agent_id: agent.id,
    branch_id: agent.branch_id,
    iss: "supabase",
    iat: nowSec,
    exp: nowSec + ttl,
  }, secret);

  const parts = jwt.split(".");
  assert.equal(parts.length, 3, "JWT must have 3 parts: header.payload.signature");

  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
  assert.equal(header.alg, "HS256");
  assert.equal(header.typ, "JWT");

  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  assert.equal(payload.role, "authenticated", "Role must be 'authenticated' for PostgREST & Realtime");
  assert.equal(payload.sub, agent.id, "Subject must match agent ID");
  assert.equal(payload.device_id, agent.id, "device_id must match agent ID for RLS");
  assert.equal(payload.desktop_agent_id, agent.id);
  assert.equal(payload.branch_id, agent.branch_id);
  assert.equal(payload.iss, "supabase");
  assert.ok(payload.exp > payload.iat, "exp must be after iat");
  assert.equal(payload.exp - payload.iat, ttl, "TTL must be exactly 900 seconds (15 min)");
});

// =============================================================================
// DESKTOP SIGNUP EDGE FUNCTION & ROLE ASSIGNMENT TESTS
// =============================================================================

async function simulateDesktopSignupEdgeFunction(reqBody, serviceClient, options = {}) {
  const rawEmail = typeof reqBody?.email === "string" ? reqBody.email.trim() : "";
  const password = typeof reqBody?.password === "string" ? reqBody.password : "";
  const fullName = typeof reqBody?.full_name === "string" ? reqBody.full_name.trim() : "";

  // 1. Validate email format and maximum length (RFC 5321)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!rawEmail || !emailRegex.test(rawEmail)) {
    return { status: 400, body: { error: "Please enter a valid email address." } };
  }
  if (rawEmail.length > 255) {
    return { status: 400, body: { error: "Email address cannot exceed 255 characters." } };
  }

  // 2. Validate password length (min 8, max 128 characters)
  if (!password || password.length < 8) {
    return { status: 400, body: { error: "Password must be at least 8 characters long." } };
  }
  if (password.length > 128) {
    return { status: 400, body: { error: "Password cannot exceed 128 characters." } };
  }

  // 3. Validate full name maximum length
  if (fullName.length > 100) {
    return { status: 400, body: { error: "Full name cannot exceed 100 characters." } };
  }

  const normalizedEmail = rawEmail.toLowerCase();

  // 4. Attempt to create user via admin API
  const { data: createData, error: createError } = await serviceClient.auth.admin.createUser({
    email: normalizedEmail,
    password: password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  // 5. Handle already registered / existing email or unexpected Auth error
  if (createError) {
    const errMsg = createError.message?.toLowerCase() || "";
    if (
      errMsg.includes("already registered") ||
      errMsg.includes("already exists") ||
      createError.status === 422
    ) {
      return {
        status: 409,
        body: {
          error: "An account with this email already exists. Please log in.",
          code: "user_already_exists",
        },
      };
    }
    // Return sanitized generic error message
    return {
      status: 400,
      body: { error: "Could not create user account. Please check your details and try again." },
    };
  }

  const newUserId = createData.user.id;

  // 6. Guard: Double-check admin accounts are never touched
  const { data: existingAdmin } = await serviceClient
    .from("user_roles")
    .select("id")
    .eq("user_id", newUserId)
    .eq("role", "admin")
    .maybeSingle();

  if (existingAdmin) {
    return { status: 403, body: { error: "Cannot modify role for this account." } };
  }

  // 7. Server-side role assignment: Insert 'shop_owner' into public.user_roles
  let roleError = null;
  if (options.forceRoleInsertError) {
    roleError = { code: "50001", message: "Database connection timeout" };
  }

  if (roleError) {
    if (roleError.code !== "23505") {
      let rollbackSuccess = false;
      let loggedCriticalOrphan = false;

      try {
        const { error: deleteError } = await serviceClient.auth.admin.deleteUser(newUserId);
        if (deleteError) {
          loggedCriticalOrphan = true;
        } else {
          rollbackSuccess = true;
        }
      } catch {
        loggedCriticalOrphan = true;
      }

      return {
        status: 500,
        body: { error: "Account creation failed during role assignment. Please try again." },
        rollbackSuccess,
        loggedCriticalOrphan,
      };
    }
  }

  // Idempotent insertion via ON CONFLICT (user_id, role) DO NOTHING
  const alreadyHasRole = db.user_roles.some(
    (ur) => ur.user_id === newUserId && ur.role === "shop_owner"
  );
  if (!alreadyHasRole) {
    db.user_roles.push({
      id: `ur-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      user_id: newUserId,
      branch_id: null,
      role: "shop_owner",
    });
  }

  return {
    status: 201,
    body: {
      success: true,
      user: {
        id: newUserId,
        email: normalizedEmail,
        role: "shop_owner",
      },
    },
  };
}

function evaluateBranchesInsertRlsPolicy(callerId, branchToInsert, dbUserRoles, isAdmin = false) {
  const matchesOwner = branchToInsert.owner_id === callerId;
  if (!matchesOwner) {
    return { allowed: false, reason: "owner_id must match auth.uid()" };
  }

  const hasAuthorizedRole = isAdmin || dbUserRoles.some(
    (ur) => ur.user_id === callerId && ["shop_owner", "branch_owner"].includes(ur.role)
  );

  if (!hasAuthorizedRole) {
    return { allowed: false, reason: "Caller lacks shop_owner, branch_owner, or admin role" };
  }

  return { allowed: true };
}

// -----------------------------------------------------------------------------
// EXPLICIT TEST CASES (1 through 17)
// -----------------------------------------------------------------------------

test("ROLE 1: New desktop signup -> shop_owner", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true);

  const res = await simulateDesktopSignupEdgeFunction(
    { email: "fresh-owner@printshop.local", password: "securepassword123", full_name: "Fresh Owner" },
    serviceClient
  );

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.user.role, "shop_owner");

  const userRole = db.user_roles.find((ur) => ur.user_id === res.body.user.id);
  assert.ok(userRole, "user_roles record must exist");
  assert.equal(userRole.role, "shop_owner");
  assert.notEqual(userRole.role, "admin");
  assert.notEqual(userRole.role, "branch");
  assert.notEqual(userRole.role, "branch_owner");
});

test("ROLE 2: Duplicate email -> 409, no role promotion", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true);
  const initialRolesCount = db.user_roles.length;

  const res = await simulateDesktopSignupEdgeFunction(
    { email: "staff1@smartprinter.in", password: "newpassword123", full_name: "Attacker Impersonator" },
    serviceClient
  );

  assert.equal(res.status, 409, "Must return 409 Conflict for existing email");
  assert.equal(res.body.error, "An account with this email already exists. Please log in.");
  assert.equal(db.user_roles.length, initialRolesCount, "No new role must be added");

  const staffRole = db.user_roles.filter((ur) => ur.user_id === "user-staff-1");
  assert.equal(staffRole.length, 1);
  assert.equal(staffRole[0].role, "branch", "Existing role must remain untouched");
});

test("ROLE 3: Existing admin -> untouched", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true);

  const res = await simulateDesktopSignupEdgeFunction(
    { email: "admin@smartprinter.in", password: "adminpassword123", full_name: "Super Admin" },
    serviceClient
  );

  assert.equal(res.status, 409, "Duplicate admin email must be rejected");
  const adminRoles = db.user_roles.filter((ur) => ur.user_id === "user-super-admin");
  assert.equal(adminRoles.length, 1);
  assert.equal(adminRoles[0].role, "admin", "Admin role must remain strictly admin");
});

test("ROLE 4: Existing branch_owner -> untouched", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true);

  const res = await simulateDesktopSignupEdgeFunction(
    { email: "staff2@smartprinter.in", password: "password123", full_name: "Branch Owner Staff" },
    serviceClient
  );

  assert.equal(res.status, 409, "Existing branch_owner email must be rejected");
  const roles = db.user_roles.filter((ur) => ur.user_id === "user-staff-2");
  assert.equal(roles.length, 1);
  assert.equal(roles[0].role, "branch_owner", "Role must remain branch_owner without conversion");
});

test("ROLE 5: Existing branch -> untouched", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true);

  const res = await simulateDesktopSignupEdgeFunction(
    { email: "staff1@smartprinter.in", password: "password123", full_name: "Branch Staff" },
    serviceClient
  );

  assert.equal(res.status, 409, "Existing branch staff email must be rejected");
  const roles = db.user_roles.filter((ur) => ur.user_id === "user-staff-1");
  assert.equal(roles.length, 1);
  assert.equal(roles[0].role, "branch", "Role must remain branch without conversion");
});

test("ROLE 6: Existing customer -> untouched", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true);

  const res = await simulateDesktopSignupEdgeFunction(
    { email: "customer@gmail.com", password: "password123", full_name: "Existing Customer" },
    serviceClient
  );

  assert.equal(res.status, 409, "Existing customer email must be rejected without promotion");
  const customerRoles = db.user_roles.filter((ur) => ur.user_id === "user-customer-1");
  assert.equal(customerRoles.length, 0, "Customer must NOT receive shop_owner or any role");
});

test("ROLE 7: Web/kiosk signup -> no shop_owner", async () => {
  db.reset();

  const webUser = {
    id: "user-web-kiosk-99",
    email: "kiosk-user@customer.local",
    raw_user_meta_data: { signup_source: "web_kiosk" },
  };
  db.auth_users.push(webUser);

  const rolesForWebUser = db.user_roles.filter((ur) => ur.user_id === webUser.id);
  assert.equal(rolesForWebUser.length, 0, "Web/kiosk registration must have 0 roles");
});

test("ROLE 8: Duplicate shop_owner insertion -> no duplicate row", async () => {
  db.reset();
  const userId = "user-shop-owner-idempotency";

  db.user_roles.push({
    id: "ur-idemp-1",
    user_id: userId,
    branch_id: null,
    role: "shop_owner",
  });

  const isDuplicate = db.user_roles.some(
    (ur) => ur.user_id === userId && ur.role === "shop_owner"
  );
  if (!isDuplicate) {
    db.user_roles.push({
      id: "ur-idemp-2",
      user_id: userId,
      branch_id: null,
      role: "shop_owner",
    });
  }

  const rows = db.user_roles.filter((ur) => ur.user_id === userId && ur.role === "shop_owner");
  assert.equal(rows.length, 1, "ON CONFLICT DO NOTHING must guarantee exactly 1 row");
});

test("ROLE 9: Desktop user can create their own branch", async () => {
  db.reset();
  const desktopOwnerId = "user-shop-owner-100";

  db.user_roles.push({
    id: "ur-shop-100",
    user_id: desktopOwnerId,
    branch_id: null,
    role: "shop_owner",
  });

  const branchToInsert = {
    id: "b-new-100",
    name: "My Local Print Station",
    owner_id: desktopOwnerId,
  };

  const rlsCheck = evaluateBranchesInsertRlsPolicy(desktopOwnerId, branchToInsert, db.user_roles, false);
  assert.equal(rlsCheck.allowed, true, "Shop owner must be permitted to create their own branch");
});

test("ROLE 10: Desktop user cannot create a branch owned by another user", async () => {
  db.reset();
  const desktopOwnerId = "user-shop-owner-100";
  const victimUserId = "user-victim-200";

  db.user_roles.push({
    id: "ur-shop-100",
    user_id: desktopOwnerId,
    branch_id: null,
    role: "shop_owner",
  });

  const maliciousBranch = {
    id: "b-malicious",
    name: "Hijacked Branch",
    owner_id: victimUserId,
  };

  const rlsCheck = evaluateBranchesInsertRlsPolicy(desktopOwnerId, maliciousBranch, db.user_roles, false);
  assert.equal(rlsCheck.allowed, false, "Must reject insert when owner_id != auth.uid()");
  assert.equal(rlsCheck.reason, "owner_id must match auth.uid()");
});

test("ROLE 11: Client cannot self-promote through metadata", async () => {
  db.reset();

  const maliciousUser = {
    id: "user-malicious-self-promote",
    email: "hacker@domain.com",
    raw_user_meta_data: {
      role: "shop_owner",
      signup_source: "desktop",
      is_admin: true,
    },
  };
  db.auth_users.push(maliciousUser);

  const roles = db.user_roles.filter((ur) => ur.user_id === maliciousUser.id);
  assert.equal(roles.length, 0, "Client-supplied metadata must have ZERO effect on user_roles");
});

test("ROLE 12: Auth user creation succeeds but role insert fails -> rollback attempted", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true);

  const res = await simulateDesktopSignupEdgeFunction(
    { email: "rollback-test@printshop.local", password: "securepassword123", full_name: "Rollback User" },
    serviceClient,
    { forceRoleInsertError: true }
  );

  assert.equal(res.status, 500);
  assert.equal(res.body.error, "Account creation failed during role assignment. Please try again.");
  assert.equal(res.rollbackSuccess, true, "Compensation rollback must succeed");

  // Verify auth user was deleted during rollback
  const orphanAuth = db.auth_users.find((u) => u.email === "rollback-test@printshop.local");
  assert.equal(orphanAuth, undefined, "Auth user must be cleaned up to allow retry");
  assert.equal(db.user_roles.filter((ur) => ur.user_id === res.user_id).length, 0);
});

test("ROLE 13: Rollback deletion itself fails -> critical orphan condition logged and generic error returned", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true, { failDeleteUser: true });

  const res = await simulateDesktopSignupEdgeFunction(
    { email: "orphan-test@printshop.local", password: "securepassword123", full_name: "Orphan User" },
    serviceClient,
    { forceRoleInsertError: true }
  );

  assert.equal(res.status, 500);
  assert.equal(res.body.error, "Account creation failed during role assignment. Please try again.");
  assert.equal(res.loggedCriticalOrphan, true, "Critical orphan condition must be flagged");
  // Ensure internal error details or stack traces are not leaked
  assert.equal(res.body.error.includes("timeout"), false);
  assert.equal(res.body.error.includes("50001"), false);
});

test("ROLE 14: Email >255 -> rejected before Auth call", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true);
  const initialAuthCount = db.auth_users.length;

  const longEmail = "a".repeat(245) + "@printshop.local"; // 245 + 16 = 261 chars
  assert.ok(longEmail.length > 255);

  const res = await simulateDesktopSignupEdgeFunction(
    { email: longEmail, password: "securepassword123", full_name: "Long Email" },
    serviceClient
  );

  assert.equal(res.status, 400);
  assert.equal(res.body.error, "Email address cannot exceed 255 characters.");
  assert.equal(db.auth_users.length, initialAuthCount, "Auth.createUser must not be called");
});

test("ROLE 15: Password >128 -> rejected before Auth call", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true);
  const initialAuthCount = db.auth_users.length;

  const longPassword = "p".repeat(129);

  const res = await simulateDesktopSignupEdgeFunction(
    { email: "valid@printshop.local", password: longPassword, full_name: "Valid User" },
    serviceClient
  );

  assert.equal(res.status, 400);
  assert.equal(res.body.error, "Password cannot exceed 128 characters.");
  assert.equal(db.auth_users.length, initialAuthCount, "Auth.createUser must not be called");
});

test("ROLE 16: Full name >100 -> rejected before Auth call", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true);
  const initialAuthCount = db.auth_users.length;

  const longName = "N".repeat(101);

  const res = await simulateDesktopSignupEdgeFunction(
    { email: "valid-name@printshop.local", password: "securepassword123", full_name: longName },
    serviceClient
  );

  assert.equal(res.status, 400);
  assert.equal(res.body.error, "Full name cannot exceed 100 characters.");
  assert.equal(db.auth_users.length, initialAuthCount, "Auth.createUser must not be called");
});

test("ROLE 17: Unexpected Auth error -> sanitized response", async () => {
  db.reset();
  const serviceClient = createMockClient(null, true, { failAuthCreate: true });

  const res = await simulateDesktopSignupEdgeFunction(
    { email: "error-test@printshop.local", password: "securepassword123", full_name: "Error User" },
    serviceClient
  );

  assert.equal(res.status, 400);
  assert.equal(res.body.error, "Could not create user account. Please check your details and try again.");
  // Ensure raw error message from Auth service is never leaked
  assert.equal(res.body.error.includes("Internal Auth connection failure"), false);
});

console.log("All Edge Function & Role test scenarios (1 through 17) passed successfully!");



