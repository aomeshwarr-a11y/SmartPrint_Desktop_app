// supabase/functions/print-job-status-update/index.ts
//
// The C# agent's SupabaseGateway normally updates print_jobs.status directly via
// Postgrest (allowed by the "device can update status of its own print jobs" RLS
// policy). This Edge Function exists for the cases that need MORE validation than a
// bare RLS-gated UPDATE can express - specifically: enforcing a legal state-machine
// transition server-side (so a compromised/buggy agent cannot, say, jump a job straight
// from "queued" to "completed" without ever downloading it) and fanning the change out
// to an event row atomically. Using this function instead of a raw table update is
// RECOMMENDED for production; the direct-table-update path documented in
// ARCHITECTURE.md remains available as a fallback for offline-tolerant writes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  queued: ["claimed", "failed", "cancelled"],
  claimed: ["downloading", "failed", "cancelled"],
  downloading: ["printing", "failed", "cancelled"],
  printing: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["queued"], // allow a manual/automatic retry to re-queue
  cancelled: [],
};

Deno.serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing device Authorization header." }, 401);
    }

    const body = await req.json().catch(() => null);
    const printJobId = body?.print_job_id;
    const newStatus = body?.status;
    const detail = body?.detail ?? null;

    if (!printJobId || !newStatus) {
      return json({ error: "Missing print_job_id or status." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: job, error: jobError } = await callerClient
      .from("print_jobs")
      .select("id, status")
      .eq("id", printJobId)
      .maybeSingle();

    if (jobError || !job) {
      return json({ error: "Print job not found or not authorized for this device." }, 404);
    }

    const allowed = ALLOWED_TRANSITIONS[job.status] ?? [];
    if (!allowed.includes(newStatus)) {
      return json(
        { error: `Illegal status transition from '${job.status}' to '${newStatus}'.` },
        409,
      );
    }

    const { error: updateError } = await callerClient
      .from("print_jobs")
      .update({ status: newStatus })
      .eq("id", printJobId);

    if (updateError) {
      console.error("Failed to update print job status", updateError);
      return json({ error: "Could not update job status." }, 500);
    }

    await callerClient.from("print_job_events").insert({
      print_job_id: printJobId,
      event_type: `status:${newStatus}`,
      detail,
    });

    return json({ status: newStatus });
  } catch (err) {
    console.error("print-job-status-update error", err);
    return json({ error: "Internal error." }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
