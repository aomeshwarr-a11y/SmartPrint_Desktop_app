// supabase/functions/desktop-signup/index.ts
//
// Dedicated Edge Function for SmartPrinter Desktop Application Registration.
//
// Security Design:
// 1. Only called by the Desktop Application during new shop owner registration.
// 2. Runs with SUPABASE_SERVICE_ROLE_KEY to securely create the auth user and assign the
//    'shop_owner' role in public.user_roles on the backend.
// 3. Does NOT trust any client-supplied role or signup_source metadata.
// 4. Strict input limits enforced before any Auth processing:
//    - Email: valid format, max 255 characters
//    - Password: min 8 characters, max 128 characters
//    - Full name: max 100 characters
// 5. Strictly protects existing accounts:
//    - If the email is already registered, returns HTTP 409 Conflict immediately.
//    - Does NOT automatically promote existing users to shop_owner.
//    - Does NOT verify existing passwords during signup.
//    - Admin accounts are never altered, demoted, or assigned conflicting roles.
//    - Existing branch_owner, branch staff, and customer accounts remain completely untouched.
// 6. Compensation rollback:
//    - If auth user creation succeeds but role assignment fails with a non-duplicate error,
//      attempts deletion of the created auth user.
//    - If cleanup fails, logs a [CRITICAL_ORPHAN_ACCOUNT] condition.
//    - Always returns a sanitized generic error without leaking database or auth internals.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, json } from "../_shared/cors.ts";

const getEnv = (key: string): string => {
  if (typeof Deno !== "undefined" && Deno.env) {
    return Deno.env.get(key) || "";
  }
  return (typeof process !== "undefined" && process.env ? process.env[key] : "") || "";
};

export async function handleDesktopSignup(req: Request): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405);
  }

  try {
    const supabaseUrl = getEnv("SUPABASE_URL");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Server misconfiguration: missing Supabase environment variables." }, 500);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const body = await req.json().catch(() => ({}));
    const rawEmail = typeof body?.email === "string" ? body.email.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const fullName = typeof body?.full_name === "string" ? body.full_name.trim() : "";

    // 1. Validate email format and maximum length (RFC 5321)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!rawEmail || !emailRegex.test(rawEmail)) {
      return json({ error: "Please enter a valid email address." }, 400);
    }
    if (rawEmail.length > 255) {
      return json({ error: "Email address cannot exceed 255 characters." }, 400);
    }

    // 2. Validate password length (min 8, max 128 characters)
    if (!password || password.length < 8) {
      return json({ error: "Password must be at least 8 characters long." }, 400);
    }
    if (password.length > 128) {
      return json({ error: "Password cannot exceed 128 characters." }, 400);
    }

    // 3. Validate full name maximum length
    if (fullName.length > 100) {
      return json({ error: "Full name cannot exceed 100 characters." }, 400);
    }

    const normalizedEmail = rawEmail.toLowerCase();

    // 4. Attempt to create the new user via Supabase Auth Admin API
    // Note: Client cannot specify role or signup_source. Role assignment is server-enforced.
    const { data: createData, error: createError } = await serviceClient.auth.admin.createUser({
      email: normalizedEmail,
      password: password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
      },
    });

    // 5. Handle already registered / existing email or unexpected Auth creation errors
    if (createError) {
      const errMsg = createError.message?.toLowerCase() || "";
      if (
        errMsg.includes("already registered") ||
        errMsg.includes("already exists") ||
        createError.status === 422
      ) {
        // Strict Rule: Do NOT promote existing accounts during desktop signup.
        // Return clear error and require the user to log in normally.
        return json(
          {
            error: "An account with this email already exists. Please log in.",
            code: "user_already_exists",
          },
          409
        );
      }

      // Log detailed internal error server-side only
      console.error("Failed to create auth user:", createError);
      // Return safe, sanitized generic error message to client
      return json(
        { error: "Could not create user account. Please check your details and try again." },
        400
      );
    }

    if (!createData?.user?.id) {
      return json({ error: "User creation failed. No user ID returned." }, 500);
    }

    const newUserId = createData.user.id;

    // 6. Guard: Double-check that this user is not an admin (defense-in-depth)
    const { data: existingAdmin } = await serviceClient
      .from("user_roles")
      .select("id")
      .eq("user_id", newUserId)
      .eq("role", "admin")
      .maybeSingle();

    if (existingAdmin) {
      console.error(`Safety violation prevented: attempted role modification on admin user ${newUserId}`);
      return json({ error: "Cannot modify role for this account." }, 403);
    }

    // 7. Server-side role assignment: Insert 'shop_owner' into public.user_roles
    // Idempotent via ON CONFLICT DO NOTHING
    const { error: roleError } = await serviceClient
      .from("user_roles")
      .insert({
        user_id: newUserId,
        role: "shop_owner",
        branch_id: null,
      });

    if (roleError) {
      // Postgres unique constraint violation code is 23505 (idempotent duplicate safe)
      if (roleError.code !== "23505") {
        console.error("Failed to assign shop_owner role in user_roles:", roleError);

        // Compensation rollback: delete newly created auth user so they can retry signup cleanly
        let rollbackSuccess = false;
        try {
          const { error: deleteError } = await serviceClient.auth.admin.deleteUser(newUserId);
          if (deleteError) {
            console.error(
              `[CRITICAL_ORPHAN_ACCOUNT] Failed to rollback auth user ${newUserId} after role insertion error:`,
              deleteError
            );
          } else {
            rollbackSuccess = true;
            console.info(`Successfully rolled back orphaned auth user ${newUserId}`);
          }
        } catch (cleanupErr) {
          console.error(
            `[CRITICAL_ORPHAN_ACCOUNT] Exception during rollback of auth user ${newUserId}:`,
            cleanupErr
          );
        }

        // Return generic HTTP 500 error to client without exposing internal error or stack traces
        return json(
          { error: "Account creation failed during role assignment. Please try again." },
          500
        );
      }
    }

    // 8. Success response
    return json(
      {
        success: true,
        user: {
          id: newUserId,
          email: normalizedEmail,
          role: "shop_owner",
        },
      },
      201
    );
  } catch (err) {
    console.error("Unexpected error in desktop-signup:", err);
    return json({ error: "Internal server error." }, 500);
  }
}

// Serve with Deno if in Deno runtime
if (typeof Deno !== "undefined" && Deno.serve) {
  Deno.serve(handleDesktopSignup);
}
