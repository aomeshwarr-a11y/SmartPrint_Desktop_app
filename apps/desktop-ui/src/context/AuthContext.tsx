import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    // Listen to Supabase auth state change events:
    // - INITIAL_SESSION: Emitted when the stored session is loaded from storage.
    // - SIGNED_IN: Emitted on successful sign in or session restoration.
    // - SIGNED_OUT: Emitted when explicitly signed out or token refresh fails.
    // - TOKEN_REFRESHED: Emitted when the session access token is automatically refreshed.
    // - USER_UPDATED: Emitted when user data changes.
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

    // Also explicitly query getSession() to ensure we resolve even if INITIAL_SESSION
    // was emitted prior to subscription or in edge cases.
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          console.error("Failed to restore Supabase auth session:", error);
          setSession(null);
        } else if (data?.session) {
          setSession(data.session);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Unexpected error restoring Supabase auth session:", err);
        setSession(null);
        setLoading(false);
      });

    // Fallback safety timeout so UI never hangs indefinitely during session restoration
    const safetyTimeout = setTimeout(() => {
      if (isMounted && loading) {
        setLoading(false);
      }
    }, 4000);

    return () => {
      isMounted = false;
      clearTimeout(safetyTimeout);
      subscription.unsubscribe();
    };
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signUp(email: string, password: string) {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signUp, signOut }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider.");
  return context;
}
