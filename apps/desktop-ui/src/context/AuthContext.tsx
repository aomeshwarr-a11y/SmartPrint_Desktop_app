import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";

interface SignUpOptions {
  fullName?: string;
  role?: "shop_owner";
  signupSource?: "desktop";
}

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    options?: SignUpOptions
  ) => Promise<void>;
  signOut: () => Promise<void>;
  ensureDesktopUserRole: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!isMounted) return;

      switch (event) {
        case "INITIAL_SESSION":
          setSession(newSession);
          setLoading(false);
          break;

        case "SIGNED_IN":
          setSession(newSession);
          setLoading(false);
          break;

        case "SIGNED_OUT":
          setSession(null);
          setLoading(false);
          break;

        case "TOKEN_REFRESHED":
          setSession(newSession);
          break;

        case "USER_UPDATED":
          setSession(newSession);
          break;

        default:
          setSession(newSession);
          break;
      }
    });

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isMounted) return;

        if (error) {
          console.error(
            "Failed to restore Supabase auth session:",
            error
          );

          setSession(null);
        } else if (data?.session) {
          setSession(data.session);
        }

        setLoading(false);
      })
      .catch((err) => {
        if (!isMounted) return;

        console.error(
          "Unexpected error restoring Supabase auth session:",
          err
        );

        setSession(null);
        setLoading(false);
      });

    const safetyTimeout = setTimeout(() => {
      if (isMounted) {
        setLoading(false);
      }
    }, 4000);

    return () => {
      isMounted = false;
      clearTimeout(safetyTimeout);
      subscription.unsubscribe();
    };
  }, []);

  async function ensureDesktopUserRole(): Promise<void> {
    // Desktop registrations are assigned 'shop_owner' exclusively via the
    // server-controlled desktop-signup Edge Function.
    // Client-side self-promotion and metadata-based inspection are strictly disabled.
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      await supabase
        .from("user_roles")
        .select("role, branch_id")
        .eq("user_id", user.id);
    } catch {
      // Non-blocking verification
    }
  }

  async function signIn(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();

    const { error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error) {
      throw error;
    }

    await ensureDesktopUserRole();
  }

  async function signUp(
    email: string,
    password: string,
    options?: SignUpOptions
  ) {
    const normalizedEmail = email.trim().toLowerCase();

    // 1. Invoke the secure server-controlled desktop-signup Edge Function.
    // Server enforces the 'shop_owner' role using service_role credentials and refuses
    // to trust or accept client-supplied role or metadata boundaries.
    const { data, error } = await supabase.functions.invoke("desktop-signup", {
      body: {
        email: normalizedEmail,
        password,
        full_name: options?.fullName?.trim() ?? "",
      },
    });

    if (error) {
      let errorMsg = error.message || "Could not create account.";
      if ((error as any).context && typeof (error as any).context.json === "function") {
        try {
          const parsed = await (error as any).context.json();
          if (parsed?.error) {
            errorMsg = parsed.error;
          }
        } catch {
          // ignore parse error
        }
      }
      throw new Error(errorMsg);
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    // 2. Establish authenticated session via standard sign-in
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (signInError) {
      console.warn("Account created with shop_owner role, but auto-login did not complete:", signInError);
    } else {
      await ensureDesktopUserRole();
    }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      throw error;
    }
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        signIn,
        signUp,
        signOut,
        ensureDesktopUserRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used within an AuthProvider."
    );
  }

  return context;
}
