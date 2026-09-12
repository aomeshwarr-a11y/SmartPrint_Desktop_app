import React, { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Signup() {
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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
    if (!agreeTerms) {
      setError("Please agree to the Terms and Privacy Policy to proceed.");
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

  // Confirmation email success screen
  if (done) {
    return (
      <div className="flex h-screen w-screen flex-col bg-[#071328] select-none overflow-hidden font-sans text-slate-100 antialiased">
        {/* TOP SMARTPRINTER APPLICATION HEADER */}
        <header className="flex h-14 w-full items-center justify-between border-b border-[#14233e] px-7 shrink-0 bg-[#061021]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0062d2] text-white shadow-sm">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight text-white">SmartPrinter</span>
          </div>

          <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
            <span>SmartPrinter</span>
            <span className="text-slate-600">|</span>
            <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Online
            </span>
          </div>
        </header>

        {/* EMAIL SENT CONFIRMATION CARD */}
        <main className="flex flex-1 items-center justify-center p-6 min-h-0 bg-[#071328]">
          <div className="w-full max-w-[430px] rounded-3xl bg-white p-8 lg:p-10 shadow-2xl text-center text-slate-800">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-[#0062d2]">
              <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-[#0c1a30]">Check your email</h1>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              We sent a confirmation link to <span className="font-semibold text-slate-800">{email}</span>. Confirm your email, then sign in to continue setting up your shop.
            </p>

            <button
              type="button"
              onClick={() => navigate("/login")}
              className="mt-6 w-full h-10 rounded-xl bg-[#0062d2] text-white text-xs font-semibold shadow-sm hover:bg-[#0052b3] active:scale-[0.99] transition-all cursor-pointer"
            >
              Go to Sign In
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-[#071328] select-none overflow-hidden font-sans text-slate-100 antialiased">
      {/* 1. TOP SMARTPRINTER APPLICATION HEADER (NO WINDOWS TITLE BAR) */}
      <header className="flex h-14 w-full items-center justify-between border-b border-[#14233e] px-7 shrink-0 bg-[#061021]">
        {/* Brand Logo & Name */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0062d2] text-white shadow-sm">
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z" />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight text-white">SmartPrinter</span>
        </div>

        {/* Online Status */}
        <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
          <span>SmartPrinter</span>
          <span className="text-slate-600">|</span>
          <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Online
          </span>
        </div>
      </header>

      {/* 2. MAIN APPLICATION CONTENT */}
      <main className="flex flex-1 w-full min-h-0">
        {/* LEFT PANEL: PRINTING NETWORK TOPOLOGY */}
        <section className="relative flex flex-1 items-center justify-center p-8 lg:p-12 overflow-hidden bg-[#071328]">
          {/* Subtle Ambient Glow */}
          <div
            className="absolute h-[520px] w-[520px] rounded-full pointer-events-none opacity-25 blur-3xl"
            style={{
              background: "radial-gradient(circle, rgba(0, 140, 255, 0.45) 0%, rgba(7, 19, 40, 0) 70%)",
            }}
          />

          {/* Network Visualization Container */}
          <div className="relative z-10 flex items-center justify-center w-[460px] h-[460px]">
            {/* Center Label */}
            <div className="absolute text-center z-20 pointer-events-none">
              <p className="text-base font-semibold text-slate-100 tracking-wide">
                Your Printing<br />Network
              </p>
            </div>

            {/* Orbit & Vector Paths */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 460 460">
              {/* Dashed outer orbit */}
              <circle
                cx="230"
                cy="230"
                r="165"
                fill="none"
                stroke="#1d3d6e"
                strokeWidth="1.5"
                strokeDasharray="4 6"
                opacity="0.8"
              />

              {/* Cyan Flow Arc: User -> Cloud */}
              <path
                d="M 85 220 A 165 165 0 0 1 215 65"
                fill="none"
                stroke="#38bdf8"
                strokeWidth="1.8"
                strokeDasharray="3 4"
                opacity="0.9"
              />
              <polygon points="213,61 223,65 215,73" fill="#38bdf8" />

              {/* Cyan Flow Arc: Cloud -> SmartPrinter Desktop */}
              <path
                d="M 245 65 A 165 165 0 0 1 375 220"
                fill="none"
                stroke="#38bdf8"
                strokeWidth="1.8"
                opacity="0.9"
              />
              <polygon points="371,210 376,222 381,211" fill="#38bdf8" />

              {/* Cyan Flow Arc: SmartPrinter Desktop -> Printer */}
              <path
                d="M 375 240 A 165 165 0 0 1 245 395"
                fill="none"
                stroke="#38bdf8"
                strokeWidth="1.8"
                strokeDasharray="4 4"
                opacity="0.85"
              />
              <polygon points="255,391 243,396 253,401" fill="#38bdf8" />

              {/* Cyan Flow Arc: Printer -> User */}
              <path
                d="M 215 395 A 165 165 0 0 1 85 240"
                fill="none"
                stroke="#38bdf8"
                strokeWidth="1.8"
                opacity="0.9"
              />
              <polygon points="89,250 84,238 79,249" fill="#38bdf8" />
            </svg>

            {/* TOP NODE: CLOUD */}
            <div className="absolute top-[20px] left-1/2 -translate-x-1/2 flex flex-col items-center z-30">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-lg text-[#0062d2]">
                <svg className="h-7 w-7 fill-[#0062d2]" viewBox="0 0 24 24">
                  <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
                </svg>
              </div>
              <span className="mt-2 inline-flex items-center rounded-full bg-[#05322b] border border-emerald-500/50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                Connected
              </span>
            </div>

            {/* RIGHT NODE: SMARTPRINTER DESKTOP */}
            <div className="absolute right-[20px] top-1/2 -translate-y-1/2 flex flex-col items-center z-30">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-lg text-[#0062d2]">
                <svg className="h-6 w-6 fill-[#0062d2]" viewBox="0 0 24 24">
                  <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z" />
                </svg>
              </div>
              <div className="mt-2 text-center text-[11px] font-medium text-slate-300 leading-tight">
                <div>SmartPrinter</div>
                <div>Desktop</div>
              </div>
            </div>

            {/* BOTTOM NODE: PRINTER */}
            <div className="absolute bottom-[20px] left-1/2 -translate-x-1/2 flex flex-col items-center z-30">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-lg text-[#0062d2]">
                <svg className="h-6 w-6 fill-[#0062d2]" viewBox="0 0 24 24">
                  <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z" />
                </svg>
              </div>
              <span className="mt-2 inline-flex items-center rounded-full bg-[#05322b] border border-emerald-500/50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                Connected
              </span>
              <span className="mt-1 text-[11px] font-medium text-slate-300">Printer</span>
            </div>

            {/* LEFT NODE: USER */}
            <div className="absolute left-[20px] top-1/2 -translate-y-1/2 flex flex-col items-center z-30">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#0062d2] shadow-lg text-white">
                <svg className="h-6 w-6 fill-current" viewBox="0 0 24 24">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                </svg>
              </div>
              <span className="mt-2 text-[11px] font-medium text-slate-300">User Icon</span>
            </div>

            {/* FLOATING ILLUMINATED PRINT JOBS */}
            <div className="absolute top-[135px] left-[78px] flex h-8 w-6 flex-col justify-between rounded-xs bg-white p-1 shadow-md shadow-sky-400/30 ring-1 ring-sky-300 z-20">
              <span className="h-0.5 w-full bg-slate-300 rounded-full" />
              <span className="h-0.5 w-3/4 bg-slate-300 rounded-full" />
              <span className="h-0.5 w-1/2 bg-slate-300 rounded-full" />
            </div>

            <div className="absolute bottom-[135px] left-[105px] flex h-8 w-6 flex-col justify-between rounded-xs bg-white p-1 shadow-md shadow-sky-400/30 ring-1 ring-sky-300 z-20">
              <span className="h-0.5 w-full bg-slate-300 rounded-full" />
              <span className="h-0.5 w-3/4 bg-slate-300 rounded-full" />
              <span className="h-0.5 w-1/2 bg-slate-300 rounded-full" />
            </div>
          </div>
        </section>

        {/* RIGHT PANEL: FLOATING SIGN UP CARD */}
        <section className="flex flex-1 items-center justify-center p-6 lg:p-12 min-h-0 bg-[#071328]">
          <div className="w-full max-w-[430px] rounded-3xl bg-white p-8 lg:p-10 shadow-2xl text-slate-800">
            {/* Headline */}
            <h1 className="text-2xl lg:text-[26px] font-extrabold tracking-tight text-[#0c1a30] leading-tight">
              Create your<br />SmartPrinter account
            </h1>
            <p className="mt-2 text-xs text-slate-500">
              Connect your printer and start managing print jobs effortlessly.
            </p>

            {/* Error Banner */}
            {error && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                {error}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="mt-5 space-y-3">
              {/* Full Name Input */}
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-400">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </span>
                <input
                  type="text"
                  placeholder="Full name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3.5 text-xs text-slate-900 placeholder-slate-400 focus:border-[#0062d2] focus:outline-none focus:ring-1 focus:ring-[#0062d2] transition"
                />
              </div>

              {/* Email Input */}
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-400">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </span>
                <input
                  type="email"
                  required
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3.5 text-xs text-slate-900 placeholder-slate-400 focus:border-[#0062d2] focus:outline-none focus:ring-1 focus:ring-[#0062d2] transition"
                />
              </div>

              {/* Password Input */}
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-400">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                </span>
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-10 text-xs text-slate-900 placeholder-slate-400 focus:border-[#0062d2] focus:outline-none focus:ring-1 focus:ring-[#0062d2] transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Confirm Password Input */}
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 px-3.5 text-xs text-slate-900 placeholder-slate-400 focus:border-[#0062d2] focus:outline-none focus:ring-1 focus:ring-[#0062d2] transition"
                />
              </div>

              {/* Terms Checkbox */}
              <div className="pt-1">
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={agreeTerms}
                    onChange={(e) => setAgreeTerms(e.target.checked)}
                    className="h-3.5 w-3.5 rounded text-[#0062d2] border-slate-300 focus:ring-[#0062d2]"
                  />
                  <span>
                    I agree to the{" "}
                    <a
                      href="#terms"
                      onClick={(e) => e.preventDefault()}
                      className="text-[#0062d2] hover:underline"
                    >
                      Terms and Privacy Policy
                    </a>
                  </span>
                </label>
              </div>

              {/* Primary Submit Button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full h-10 rounded-xl bg-[#0062d2] text-white text-xs font-semibold shadow-sm hover:bg-[#0052b3] active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50 mt-2"
              >
                {submitting ? "Creating account..." : "Create Account"}
              </button>
            </form>

            {/* Switch to Login */}
            <p className="mt-5 text-center text-xs text-slate-500">
              Already have an account?{" "}
              <Link to="/login" className="font-semibold text-[#0062d2] hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}