// supabase/functions/signed-url-generate/index.ts
//
// Issues a short-lived signed URL for a print job's uploaded file. The caller must
// present the device's own JWT (from device-token-refresh) as a Bearer token - we then
// re-verify the job belongs to that device using a client bound to the CALLER's JWT
// (so RLS does the ownership check for us, see migrations/0002_rls_policies.sql
// "device can read its own print jobs"), and only then use the service_role client to
// actually mint the signed URL against Storage.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SIGNED_URL_TTL_SECONDS = 600; // short expiry - see ARCHITECTURE.md §7
const STORAGE_BUCKET = "print-uploads";

Deno.serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing device Authorization header." }, 401);
    }

    const body = await req.json().catch(() => null);
    const printJobId = body?.print_job_id;
    if (!printJobId) {
      return json({ error: "Missing print_job_id." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // RLS ensures this only returns a row if the presented device JWT's device_id
    // matches print_jobs.device_id - an attempt to request another shop's file simply
    // returns no row here, well before we ever touch Storage.
    const { data: job, error: jobError } = await callerClient
      .from("print_jobs")
      .select("id, storage_path")
      .eq("id", printJobId)
      .maybeSingle();

    if (jobError || !job) {
      return json({ error: "Print job not found or not authorized for this device." }, 404);
    }

    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: signed, error: signError } = await serviceClient.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(job.storage_path, SIGNED_URL_TTL_SECONDS);

    if (signError || !signed) {
      console.error("Failed to create signed URL", signError);
      return json({ error: "Could not generate signed URL." }, 500);
    }

    return json({ signed_url: signed.signedUrl, expires_in: SIGNED_URL_TTL_SECONDS });
  } catch (err) {
    console.error("signed-url-generate error", err);
    return json({ error: "Internal error." }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
