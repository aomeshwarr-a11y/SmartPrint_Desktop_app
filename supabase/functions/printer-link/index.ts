// supabase/functions/printer-link/index.ts
//
// Links a physical printer to an active paired Desktop Agent.
//
// Security & Validation:
//   - Caller must be an authorized branch user (owner/manager/staff/admin) OR the active agent itself.
//   - Printer must exist.
//   - Desktop Agent must exist and have status = 'active'.
//   - Strict cross-branch check: printer.branch_id MUST match desktop_agent.branch_id.
//   - Records a 'printer_linked' lifecycle event in desktop_agent_events.
//   - Existing printers remain desktop_agent_id = NULL until this endpoint is explicitly invoked.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, json } from "../_shared/cors.ts";
import {
  verifyUserSession,
  verifyBranchAuthorization,
  extractBearerToken,
  authenticateAgentToken,
} from "../_shared/auth.ts";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const getEnv = (key: string): string => {
  if (typeof Deno !== "undefined" && Deno.env) {
    return Deno.env.get(key) || "";
  }
  return (typeof process !== "undefined" && process.env ? process.env[key] : "") || "";
};

export async function handlePrinterLink(req: Request): Promise<Response> {
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

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ error: "Invalid JSON request body." }, 400);
    }

    const printerId = typeof body.printer_id === "string" ? body.printer_id.trim() : "";
    const desktopAgentId = typeof body.desktop_agent_id === "string" ? body.desktop_agent_id.trim() : "";

    if (!UUID_REGEX.test(printerId) || !UUID_REGEX.test(desktopAgentId)) {
      return json({ error: "Both printer_id and desktop_agent_id must be valid UUIDs." }, 400);
    }

    // 1. Fetch printer
    const { data: printer, error: printerErr } = await serviceClient
      .from("printers")
      .select("id, branch_id, name")
      .eq("id", printerId)
      .maybeSingle();

    if (printerErr || !printer) {
      return json({ error: "Printer not found." }, 404);
    }

    // 2. Fetch desktop agent
    const { data: agent, error: agentErr } = await serviceClient
      .from("desktop_agents")
      .select("id, branch_id, status, agent_name")
      .eq("id", desktopAgentId)
      .maybeSingle();

    if (agentErr || !agent) {
      return json({ error: "Desktop agent not found." }, 404);
    }

    if (agent.status !== "active") {
      return json({ error: `Desktop agent status is '${agent.status}'. Only active agents can be linked to printers.` }, 400);
    }

    // 3. Enforce branch isolation: cross-branch linking is strictly prohibited
    if (printer.branch_id !== agent.branch_id) {
      return json({
        error: "Cross-branch linking forbidden: printer and desktop agent must belong to the same branch.",
      }, 403);
    }

    // 4. Authenticate caller (User JWT or Agent Bearer Token)
    let isAuthorized = false;
    const authHeader = req.headers.get("Authorization");

    // Check if caller is an authenticated user
    if (authHeader) {
      const callerClient = createClient(supabaseUrl, anonKey || serviceRoleKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const user = await verifyUserSession(callerClient);
      if (user) {
        isAuthorized = await verifyBranchAuthorization(
          serviceClient,
          callerClient,
          user.id,
          printer.branch_id
        );
        if (!isAuthorized) {
          return json({ error: "Forbidden: You are not authorized to manage printers for this branch." }, 403);
        }
      }
    }

    // If not authorized as a user, check if caller is the active agent itself
    if (!isAuthorized) {
      const rawToken = extractBearerToken(req, body);
      if (rawToken) {
        const agentAuth = await authenticateAgentToken(serviceClient, rawToken);
        if (agentAuth && agentAuth.agent.id === agent.id && agentAuth.agent.branch_id === printer.branch_id) {
          isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      return json({ error: "Authentication failed. Authorized branch user or active agent token required." }, 401);
    }

    // 5. Update printer with desktop_agent_id
    const { error: updateError } = await serviceClient
      .from("printers")
      .update({ desktop_agent_id: agent.id })
      .eq("id", printer.id);

    if (updateError) {
      console.error("Failed to link printer to desktop agent:", updateError);
      return json({ error: "Database error while linking printer." }, 500);
    }

    // 6. Record 'printer_linked' audit lifecycle event
    await serviceClient.from("desktop_agent_events").insert({
      desktop_agent_id: agent.id,
      event_type: "printer_linked",
      detail: {
        printer_id: printer.id,
        printer_name: printer.name ?? null,
        branch_id: printer.branch_id,
      },
    });

    console.log(`Printer ${printer.id} linked to Desktop Agent ${agent.id} (Branch: ${printer.branch_id})`);

    return json({
      linked: true,
      printer_id: printer.id,
      desktop_agent_id: agent.id,
      branch_id: printer.branch_id,
    });
  } catch (err) {
    console.error("Unexpected error in printer-link:", err);
    return json({ error: "Internal server error." }, 500);
  }
}

// Serve with Deno if in Deno runtime
if (typeof Deno !== "undefined" && Deno.serve) {
  Deno.serve(handlePrinterLink);
}
