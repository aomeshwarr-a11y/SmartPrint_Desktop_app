import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isSupabaseConfigured } from "../lib/supabaseClient";

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate("/shop-setup");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-cream px-6">
      <form onSubmit={handleSubmit} className="card w-full max-w-sm">
        <h1 className="mb-1 text-xl font-semibold text-brand-900">Log in</h1>
        <p className="mb-6 text-sm text-brand-500">Use your SmartPrinter owner account.</p>

        {!isSupabaseConfigured && (
          <div className="mb-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            Supabase is not configured yet. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.
          </div>
        )}

        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          className="input mb-4"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          className="input mb-4"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? "Signing in..." : "Log in"}
        </button>

        <p className="mt-4 text-center text-sm text-brand-500">
          New here?{" "}
          <Link to="/signup" className="font-medium text-brand-700">
            Create an account
          </Link>
        </p>
      </form>
    </div>
  );
}
