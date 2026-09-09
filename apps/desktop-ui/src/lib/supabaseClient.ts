import { createClient } from "@supabase/supabase-js";

/**
 * This client is used ONLY for the shop owner's own login/signup/session in the
 * Electron UI (Supabase Auth) - it uses the public anon key, exactly as a normal web
 * app would, and is subject to the same RLS policies as any other authenticated user.
 * It is never used to read/write print jobs directly; that all happens through the
 * background agent's own device-scoped session (see services/desktop-agent/.../Cloud).
 *
 * Configure via a build-time .env file (Vite): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY.
 * See .env.example at the repo root.
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  // We don't throw here - the Welcome/Login screens render a clear configuration error
  // instead of a blank white screen, which is much easier to debug on a fresh checkout.
  console.warn(
    "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. Copy .env.example to .env and fill them in. See docs/SUPABASE-SETUP.md.",
  );
}

export const supabase = createClient(supabaseUrl ?? "https://placeholder.supabase.co", supabaseAnonKey ?? "placeholder-anon-key");

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
