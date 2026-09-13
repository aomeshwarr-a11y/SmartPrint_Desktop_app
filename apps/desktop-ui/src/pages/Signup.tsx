import React, { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Signup() {
  const { signUp } = useAuth();
  const navigate = useNavigate();

  // Form state
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Submission state
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!agreeTerms) {
      setError("Please accept the Terms of Service and Privacy Policy.");
      return;
    }

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
      setError(
        err instanceof Error
          ? err.message
          : "Could not create account."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-[#f8faf9] px-6 font-sans text-slate-900">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
            <svg
              className="h-7 w-7"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>

          <h1 className="mb-2 text-2xl font-bold tracking-tight text-slate-900">
            Check your email
          </h1>

          <p className="mb-6 text-sm leading-relaxed text-slate-600">
            We sent a verification link to{" "}
            <span className="font-semibold text-slate-900">
              {email}
            </span>
            . Click the link to activate your account and start setting up
            your shop.
          </p>

          <button
            type="button"
            onClick={() => navigate("/login")}
            className="w-full rounded-xl bg-[#047857] py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#065f46]"
          >
            Go to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full flex-col justify-between bg-[#f8faf9] font-sans text-slate-900 antialiased">
      {/* 1. TOP HEADER */}
      <header className="flex h-16 w-full items-center justify-between border-b border-slate-100 bg-white/70 px-8 backdrop-blur-xs lg:px-12">
        <Link
          to="/"
          className="flex items-center gap-2.5 text-base font-bold tracking-tight text-slate-900"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-[#047857]" />
          <span>Smart Printer</span>
        </Link>

        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 transition hover:text-slate-950"
        >
          <span>←</span>
          <span>Back to Home</span>
        </Link>
      </header>

      {/* 2. MAIN SPLIT CONTAINER */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 items-center px-6 py-6 lg:px-12">
        <div className="grid w-full grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12">
          {/* LEFT: VISUAL BRAND SHOWCASE */}
          <div className="flex flex-col justify-center space-y-5 lg:col-span-6">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/80 px-3.5 py-1 text-[11px] font-bold text-[#065f46]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#047857]" />
              <span>PRINT • PAY • MANAGE • GROW</span>
            </div>

            <h1 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl lg:text-5xl lg:leading-[1.15]">
              Start your
              <br />
              printing journey
              <br />
              <span className="text-[#047857]">today.</span>
            </h1>

            <p className="max-w-md text-sm leading-relaxed text-slate-600">
              Create your account and unlock a smarter, faster, and easier way
              to manage your print shop.
            </p>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[#047857]">
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                  </svg>
                </div>

                <span className="text-xs font-semibold text-slate-800">
                  Cloud connected
                </span>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[#047857]">
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>

                <span className="text-xs font-semibold text-slate-800">
                  Secure &amp; reliable
                </span>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[#047857]">
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                  </svg>
                </div>

                <span className="text-xs font-semibold text-slate-800">
                  Built for print shops
                </span>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[#047857]">
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </div>

                <span className="text-xs font-semibold text-slate-800">
                  Get started in minutes
                </span>
              </div>
            </div>

            <div className="pt-2">
              <div className="font-serif text-2xl font-bold italic text-[#047857]">
                Print Better
                <br />
                Together.
              </div>

              <div className="mt-1 h-0.5 w-14 rounded bg-[#047857]/40" />
            </div>
          </div>

          {/* RIGHT: REGISTRATION CARD */}
          <div className="flex justify-center lg:col-span-6">
            <div className="w-full max-w-[460px] rounded-3xl border border-slate-200/90 bg-white p-7 shadow-xl shadow-slate-200/50">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-950">
                  Create your account
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  Join Smart Printer and get started in minutes.
                </p>
              </div>

              <form
                onSubmit={handleSubmit}
                className="mt-5 space-y-3.5"
              >
                {error && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800">
                    {error}
                  </div>
                )}

                {/* Full Name */}
                <div>
                  <label
                    className="mb-1 block text-xs font-medium text-slate-700"
                    htmlFor="fullName"
                  >
                    Full Name
                  </label>

                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-slate-400">
                      <svg
                        className="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    </span>

                    <input
                      id="fullName"
                      type="text"
                      placeholder="Enter your full name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-3 text-xs text-slate-900 placeholder-slate-400 focus:border-[#047857] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#047857]"
                    />
                  </div>
                </div>

                {/* Email Address */}
                <div>
                  <label
                    className="mb-1 block text-xs font-medium text-slate-700"
                    htmlFor="email"
                  >
                    Email Address
                  </label>

                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-slate-400">
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
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-3 text-xs text-slate-900 placeholder-slate-400 focus:border-[#047857] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#047857]"
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label
                    className="mb-1 block text-xs font-medium text-slate-700"
                    htmlFor="password"
                  >
                    Password
                  </label>

                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-slate-400">
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
                        />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </span>

                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      required
                      placeholder="Create a strong password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-9 text-xs text-slate-900 placeholder-slate-400 focus:border-[#047857] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#047857]"
                    />

                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      <svg
                        className="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Confirm Password */}
                <div>
                  <label
                    className="mb-1 block text-xs font-medium text-slate-700"
                    htmlFor="confirmPassword"
                  >
                    Confirm Password
                  </label>

                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-slate-400">
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
                        />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </span>

                    <input
                      id="confirmPassword"
                      type={
                        showConfirmPassword ? "text" : "password"
                      }
                      required
                      placeholder="Confirm your password"
                      value={confirmPassword}
                      onChange={(e) =>
                        setConfirmPassword(e.target.value)
                      }
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-9 text-xs text-slate-900 placeholder-slate-400 focus:border-[#047857] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#047857]"
                    />

                    <button
                      type="button"
                      onClick={() =>
                        setShowConfirmPassword(!showConfirmPassword)
                      }
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      <svg
                        className="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Terms Checkbox */}
                <div className="flex items-start gap-2 pt-0.5">
                  <input
                    type="checkbox"
                    id="terms"
                    checked={agreeTerms}
                    onChange={(e) =>
                      setAgreeTerms(e.target.checked)
                    }
                    className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-[#047857] focus:ring-[#047857]"
                  />

                  <label
                    htmlFor="terms"
                    className="text-[11px] leading-tight text-slate-600"
                  >
                    I agree to the{" "}
                    <a
                      href="https://smartprinter.in/terms"
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-[#047857] hover:underline"
                    >
                      Terms of Service
                    </a>{" "}
                    and{" "}
                    <a
                      href="https://smartprinter.in/privacy"
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-[#047857] hover:underline"
                    >
                      Privacy Policy
                    </a>
                  </label>
                </div>

                {/* Submit CTA */}
                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-1 w-full cursor-pointer rounded-xl bg-[#047857] py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#065f46] active:scale-[0.99] disabled:opacity-50"
                >
                  {submitting
                    ? "Creating Account..."
                    : "Create Account →"}
                </button>

                {/* OR Divider */}
                <div className="relative my-3 flex items-center justify-center">
                  <div className="h-[1px] w-full bg-slate-200" />

                  <span className="absolute bg-white px-2.5 text-[10px] font-semibold tracking-wider text-slate-400">
                    OR
                  </span>
                </div>

                {/* SSO Buttons */}
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-2 text-[11px] font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
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
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-2 text-[11px] font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
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

                <p className="pt-1.5 text-center text-xs text-slate-500">
                  Already have an account?{" "}
                  <Link
                    to="/login"
                    className="font-bold text-[#047857] hover:underline"
                  >
                    Login
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