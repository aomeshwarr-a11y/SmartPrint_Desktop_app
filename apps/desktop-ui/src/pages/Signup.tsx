import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Signup() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      await signUp(email, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-cream px-6">
        <div className="card w-full max-w-sm text-center">
          <h1 className="mb-2 text-xl font-semibold text-brand-900">Check your email</h1>
          <p className="mb-6 text-sm text-brand-600">
            We sent a confirmation link to {email}. Confirm it, then log in to continue setting up your shop.
          </p>
          <button className="btn-primary w-full" onClick={() => navigate("/login")}>
            Go to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-cream px-6">
      <form onSubmit={handleSubmit} className="card w-full max-w-sm">
        <h1 className="mb-1 text-xl font-semibold text-brand-900">Create your account</h1>
        <p className="mb-6 text-sm text-brand-500">One account per shop owner.</p>

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

        <label className="label" htmlFor="confirmPassword">
          Confirm password
        </label>
        <input
          id="confirmPassword"
          type="password"
          required
          className="input mb-4"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? "Creating account..." : "Create account"}
        </button>

        <p className="mt-4 text-center text-sm text-brand-500">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-brand-700">
            Log in
          </Link>
        </p>
      </form>
    </div>
  );
}
