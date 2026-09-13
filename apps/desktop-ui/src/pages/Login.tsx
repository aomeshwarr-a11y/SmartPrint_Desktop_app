import React, { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isSupabaseConfigured } from "../lib/supabaseClient";

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();

  // Form states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  // Status handling
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await signIn(email, password);

      // Route straight to dashboard on successful login
      navigate("/dashboard");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not log in. Check credentials."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen w-full select-none bg-[#faf8ff] text-slate-900 font-sans antialiased selection:bg-emerald-100 selection:text-emerald-900 flex flex-col justify-between">
      {/* 1. TOP HEADER */}
      <header className="flex h-16 w-full items-center justify-between px-8 lg:px-12 border-b border-slate-100/80 bg-white/70 backdrop-blur-xs">
        {/* Brand Lockup */}
        <Link
          to="/"
          className="flex items-center gap-2.5 text-base font-bold tracking-tight text-slate-900"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-[#047857]" />
          <span>Smart Printer</span>
        </Link>

        {/* Back to Home Link */}
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-950 transition"
        >
          <span>←</span>
          <span>Back to Home</span>
        </Link>
      </header>

      {/* 2. MAIN SPLIT CONTAINER */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 items-center px-6 py-6 lg:px-12">
        <div className="grid w-full grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12">
          {/* LEFT: BRAND & VALUE PROPOSITION */}
          <div className="lg:col-span-6 flex flex-col justify-center space-y-5 pr-0 lg:pr-6">
            {/* Tagline Pill */}
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200/90 bg-emerald-50/80 px-3.5 py-1 text-[11px] font-bold text-[#065f46] tracking-wide w-fit">
              <span className="h-1.5 w-1.5 rounded-full bg-[#047857]" />
              <span>PRINT • PAY • MANAGE • GROW</span>
            </div>

            {/* Headline */}
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl lg:text-5xl lg:leading-[1.14]">
              Welcome back
              <br />
              to a smarter{" "}
              <span className="text-[#047857]">
                printing
                <br />
                experience.
              </span>
            </h1>

            {/* Subtitle */}
            <p className="text-sm text-slate-600 leading-relaxed max-w-md">
              Sign in to Smart Printer and keep your print shop running
              smoothly.
            </p>

            {/* 4 Feature Items */}
            <div className="grid grid-cols-2 gap-4 pt-1">
              {/* Cloud Connected */}
              <div className="flex items-start gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100/70 text-[#047857]">
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                  </svg>
                </div>

                <div>
                  <h4 className="text-xs font-bold text-slate-800">
                    Cloud connected
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Access from anywhere
                  </p>
                </div>
              </div>

              {/* Secure & Reliable */}
              <div className="flex items-start gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100/70 text-[#047857]">
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>

                <div>
                  <h4 className="text-xs font-bold text-slate-800">
                    Secure &amp; reliable
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Your data is safe
                  </p>
                </div>
              </div>

              {/* Built for Print Shops */}
              <div className="flex items-start gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100/70 text-[#047857]">
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>

                <div>
                  <h4 className="text-xs font-bold text-slate-800">
                    Built for print shops
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Simple. Powerful.
                  </p>
                </div>
              </div>

              {/* Get More Done */}
              <div className="flex items-start gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100/70 text-[#047857]">
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </div>

                <div>
                  <h4 className="text-xs font-bold text-slate-800">
                    Get more done
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Manage, track and grow
                  </p>
                </div>
              </div>
            </div>

            {/* Script Signature Branding */}
            <div className="pt-2">
              <div className="font-serif italic text-2xl sm:text-3xl font-bold text-[#047857] leading-tight">
                Print Better
                <br />
                Together.
              </div>

              <div className="h-0.5 w-14 bg-[#047857]/40 mt-1 rounded" />
            </div>
          </div>

          {/* RIGHT: SIGN IN CARD */}
          <div className="lg:col-span-6 flex justify-center">
            <div className="w-full max-w-[460px] rounded-3xl border border-slate-200/90 bg-white p-7 sm:p-8 shadow-xl shadow-slate-200/50">
              {/* Header Icon Badge */}
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-[#047857] mb-3">
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>

              {/* Title & Subtitle */}
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
                  Welcome back
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  Sign in to your Smart Printer account
                </p>
              </div>

              {/* Form */}
              <form
                onSubmit={handleSubmit}
                className="mt-5 space-y-4"
              >
                {/* Supabase Notice if not configured */}
                {!isSupabaseConfigured && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                    Supabase credentials missing. Running in local fallback
                    mode.
                  </div>
                )}

                {/* Error Banner */}
                {error && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800">
                    {error}
                  </div>
                )}

                {/* Email Address */}
                <div>
                  <label
                    className="mb-1 block text-xs font-semibold text-slate-700 uppercase tracking-wider text-[10px]"
                    htmlFor="email"
                  >
                    Email Address
                  </label>

                  <div className="relative">
                    <span className="absolute left-3.5 top-2.5 text-slate-400">
                      <svg
                        className="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <rect
                          x="2"
                          y="4"
                          width="20"
                          height="16"
                          rx="2"
                        />

                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                      </svg>
                    </span>

                    <input
                      id="email"
                      type="email"
                      required
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-10 pr-3 text-xs text-slate-900 placeholder-slate-400 focus:border-[#047857] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#047857]"
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label
                    className="mb-1 block text-xs font-semibold text-slate-700 uppercase tracking-wider text-[10px]"
                    htmlFor="password"
                  >
                    Password
                  </label>

                  <div className="relative">
                    <span className="absolute left-3.5 top-2.5 text-slate-400">
                      <svg
                        className="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <rect
                          x="3"
                          y="11"
                          width="18"
                          height="11"
                          rx="2"
                          ry="2"
                        />

                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </span>

                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      required
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-10 pr-10 text-xs text-slate-900 placeholder-slate-400 focus:border-[#047857] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#047857]"
                    />

                    <button
                      type="button"
                      onClick={() =>
                        setShowPassword(!showPassword)
                      }
                      className="absolute right-3.5 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      <svg
                        className="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        {showPassword ? (
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        ) : (
                          <>
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </>
                        )}
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Keep me signed in & Forgot Password */}
                <div className="flex items-center justify-between pt-0.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={keepSignedIn}
                      onChange={(e) =>
                        setKeepSignedIn(e.target.checked)
                      }
                      className="h-3.5 w-3.5 rounded border-slate-300 text-[#047857] focus:ring-[#047857]"
                    />

                    <span className="text-xs text-slate-600">
                      Keep me signed in
                    </span>
                  </label>

                  <a
                    href="#forgot"
                    className="text-xs font-semibold text-[#047857] hover:underline"
                  >
                    Forgot password?
                  </a>
                </div>

                {/* Submit CTA */}
                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-2 w-full rounded-xl bg-[#047857] py-3 text-xs font-bold text-white shadow-sm hover:bg-[#065f46] active:scale-[0.99] transition disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? "Signing in..." : "Sign In →"}
                </button>

                {/* OR Divider */}
                <div className="relative my-3.5 flex items-center justify-center">
                  <div className="h-[1px] w-full bg-slate-200" />

                  <span className="absolute bg-white px-2.5 text-[10px] font-semibold text-slate-400 tracking-wider">
                    OR
                  </span>
                </div>

                {/* SSO Buttons */}
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2 px-2 text-[11px] font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                    >
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />

                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />

                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />

                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>

                    <span>Continue with Google</span>
                  </button>

                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2 px-2 text-[11px] font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 23 23"
                    >
                      <rect
                        width="11"
                        height="11"
                        fill="#f25022"
                      />

                      <rect
                        x="12"
                        width="11"
                        height="11"
                        fill="#7fba00"
                      />

                      <rect
                        y="12"
                        width="11"
                        height="11"
                        fill="#00a4ef"
                      />

                      <rect
                        x="12"
                        y="12"
                        width="11"
                        height="11"
                        fill="#ffb900"
                      />
                    </svg>

                    <span>Continue with Microsoft</span>
                  </button>
                </div>

                {/* Footer Switch */}
                <p className="pt-2 text-center text-xs text-slate-500">
                  Don't have an account?{" "}
                  <Link
                    to="/signup"
                    className="font-bold text-[#047857] hover:underline"
                  >
                    Sign up
                  </Link>
                </p>
              </form>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}