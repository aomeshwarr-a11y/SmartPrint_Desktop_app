import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
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

  async function signIn(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();

    const { error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error) {
      throw error;
    }
  }

  async function signUp(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();

    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
    });

    if (error) {
      throw error;
    }

    /*
     * Supabase may intentionally return no error when the email
     * already belongs to an existing confirmed account.
     *
     * An empty identities array indicates that this is not a
     * newly-created identity.
     */
    if (data.user && data.user.identities?.length === 0) {
      throw new Error(
        "An account with this email already exists. Please log in."
      );
    }

    if (!data.user) {
      throw new Error(
        "Could not create account. Please try again."
      );
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