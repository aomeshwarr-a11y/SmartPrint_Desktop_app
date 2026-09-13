import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import welcomeImage from "../assets/AutoPrint.png";

export default function Welcome() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  /**
   * Authentication behavior:
   *
   * Valid session
   *      ↓
   * Dashboard
   *
   * No session
   *      ↓
   * Stay on Welcome
   */
  useEffect(() => {
    if (!loading && session) {
      navigate("/dashboard", { replace: true });
    }
  }, [session, loading, navigate]);

  const handleGetStarted = () => {
    if (session) {
      navigate("/dashboard");
    } else {
      navigate("/signup");
    }
  };

  const handleLogin = () => {
    navigate("/login");
  };

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const scrollToFeatures = () => {
    document.getElementById("features")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const scrollToHowItWorks = () => {
    document.getElementById("how-it-works")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#faf9ff] font-sans text-slate-950 antialiased">

      {/* ============================================================
          BACKGROUND DECORATION
      ============================================================ */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-40 top-20 h-96 w-96 rounded-full bg-emerald-100/30 blur-3xl" />

        <div className="absolute right-[-180px] top-[350px] h-[500px] w-[500px] rounded-full bg-blue-100/20 blur-3xl" />

        <div className="absolute left-[35%] top-[800px] h-80 w-80 rounded-full bg-emerald-100/20 blur-3xl" />
      </div>

      {/* ============================================================
          HEADER
      ============================================================ */}
      <header className="sticky top-0 z-50 border-b border-slate-200/60 bg-[#faf9ff]/90 backdrop-blur-xl">

        <div className="mx-auto flex h-[68px] w-full max-w-[1480px] items-center justify-between px-7 sm:px-8 lg:px-10 xl:px-12 2xl:px-14">

          {/* Logo */}
          <button
            type="button"
            onClick={scrollToTop}
            className="group flex cursor-pointer items-center gap-2.5"
          >
            <span className="relative flex h-3 w-3 items-center justify-center">
              <span className="absolute h-3 w-3 animate-ping rounded-full bg-emerald-400/30" />

              <span className="relative h-2.5 w-2.5 rounded-full bg-[#087f4b]" />
            </span>

            <span className="text-[17px] font-extrabold tracking-tight text-slate-950 transition-colors duration-200 group-hover:text-emerald-700">
              Smart Printer
            </span>
          </button>

          {/* Desktop navigation */}
          <nav className="hidden items-center gap-7 md:flex lg:gap-8">

            <button
              type="button"
              onClick={scrollToFeatures}
              className="cursor-pointer text-sm font-medium text-slate-500 transition-colors duration-200 hover:text-slate-950"
            >
              Features
            </button>

            <button
              type="button"
              onClick={scrollToHowItWorks}
              className="cursor-pointer text-sm font-medium text-slate-500 transition-colors duration-200 hover:text-slate-950"
            >
              How it works
            </button>

            <button
              type="button"
              onClick={handleLogin}
              className="cursor-pointer text-sm font-medium text-slate-500 transition-colors duration-200 hover:text-slate-950"
            >
              Login
            </button>

            <button
              type="button"
              onClick={handleGetStarted}
              className="group inline-flex cursor-pointer items-center gap-2 rounded-full bg-[#087f4b] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-900/10 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#076b3f] hover:shadow-xl active:translate-y-0"
            >
              Get Started

              <span className="transition-transform duration-200 group-hover:translate-x-1">
                →
              </span>
            </button>

          </nav>

          {/* Mobile button */}
          <button
            type="button"
            onClick={handleGetStarted}
            className="cursor-pointer rounded-full bg-[#087f4b] px-4 py-2 text-xs font-bold text-white shadow-md md:hidden"
          >
            Get Started
          </button>

        </div>
      </header>

      {/* ============================================================
          MAIN
      ============================================================ */}
      <main>

        {/* ==========================================================
            HERO
        ========================================================== */}
        <section className="relative mx-auto w-full max-w-[1480px] px-7 pb-20 pt-10 sm:px-8 lg:px-10 lg:pb-24 lg:pt-12 xl:px-12 2xl:px-14">

          <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-14 xl:gap-16">

            {/* ======================================================
                LEFT HERO
            ====================================================== */}
            <div className="relative z-10 lg:col-span-6">

              {/* Badge */}
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-white px-4 py-2 text-xs font-bold text-emerald-700 shadow-sm">

                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />

                <span>Simple</span>

                <span className="text-slate-300">
                  •
                </span>

                <span>Secure</span>

                <span className="text-slate-300">
                  •
                </span>

                <span>Powerful</span>

              </div>

              {/* Heading */}
              <h1 className="max-w-[720px] text-5xl font-black leading-[0.98] tracking-[-0.045em] text-slate-950 sm:text-6xl lg:text-[64px] xl:text-[68px]">

                Turn your shop into a{" "}

                <span className="text-[#087f4b]">
                  smart printing kiosk.
                </span>

              </h1>

              {/* Description */}
              <p className="mt-6 max-w-xl text-base leading-7 text-slate-500 sm:text-lg sm:leading-8">
                Connect your printers to the cloud and automate customer print
                jobs with our lightweight desktop agent.
              </p>

              {/* CTA Buttons */}
              <div className="mt-8 flex flex-wrap items-center gap-4">

                <button
                  type="button"
                  onClick={handleGetStarted}
                  className="group inline-flex cursor-pointer items-center gap-3 rounded-xl bg-[#087f4b] px-7 py-4 text-sm font-bold text-white shadow-xl shadow-emerald-900/15 transition-all duration-200 hover:-translate-y-1 hover:bg-[#076b3f] hover:shadow-2xl active:translate-y-0"
                >
                  <span>
                    Get Started
                  </span>

                  <span className="text-base transition-transform duration-200 group-hover:translate-x-1">
                    →
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleLogin}
                  className="cursor-pointer rounded-xl border border-slate-200 bg-white px-7 py-4 text-sm font-bold text-slate-800 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-slate-300 hover:bg-slate-50 hover:shadow-lg active:translate-y-0"
                >
                  Login
                </button>

              </div>

              {/* ====================================================
                  QUICK BENEFITS
              ==================================================== */}
              <div className="mt-9 grid max-w-xl grid-cols-3 gap-3">

                {/* Faster */}
                <div className="group flex cursor-default items-center gap-3 rounded-xl border border-slate-200/80 bg-white/80 p-3 transition-all duration-200 hover:-translate-y-1 hover:border-emerald-200 hover:bg-white hover:shadow-md">

                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 transition group-hover:bg-emerald-100">

                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                    </svg>

                  </div>

                  <span className="text-xs font-bold leading-tight text-slate-700">
                    Faster
                    <br />
                    processing
                  </span>

                </div>

                {/* Secure */}
                <div className="group flex cursor-default items-center gap-3 rounded-xl border border-slate-200/80 bg-white/80 p-3 transition-all duration-200 hover:-translate-y-1 hover:border-emerald-200 hover:bg-white hover:shadow-md">

                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 transition group-hover:bg-emerald-100">

                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>

                  </div>

                  <span className="text-xs font-bold leading-tight text-slate-700">
                    Secure &
                    <br />
                    reliable
                  </span>

                </div>

                {/* Business */}
                <div className="group flex cursor-default items-center gap-3 rounded-xl border border-slate-200/80 bg-white/80 p-3 transition-all duration-200 hover:-translate-y-1 hover:border-emerald-200 hover:bg-white hover:shadow-md">

                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 transition group-hover:bg-emerald-100">

                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>

                  </div>

                  <span className="text-xs font-bold leading-tight text-slate-700">
                    Built for
                    <br />
                    your business
                  </span>

                </div>

              </div>
            </div>

            {/* ======================================================
                RIGHT HERO IMAGE
            ====================================================== */}
            <div className="relative lg:col-span-6 lg:pl-2 xl:pl-4">

              {/* Glow */}
              <div className="absolute -inset-10 rounded-[4rem] bg-emerald-100/40 blur-3xl" />

              <div className="group relative overflow-visible">

                {/* Image */}
                <div className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-white p-2 shadow-[0_30px_80px_-25px_rgba(15,23,42,0.30)] transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_40px_100px_-25px_rgba(15,23,42,0.35)]">

                  <div className="overflow-hidden rounded-[1.5rem]">

                    <img
                      src={welcomeImage}
                      alt="SmartPrinter desktop application"
                      className="h-auto w-full object-cover transition-transform duration-700 group-hover:scale-[1.025]"
                    />

                  </div>

                </div>

                {/* ==================================================
                    DESKTOP AGENT BADGE
                ================================================== */}
                <div className="absolute -bottom-5 left-5 hidden items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-xl sm:flex">

                  <span className="relative flex h-3 w-3">

                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />

                    <span className="relative h-3 w-3 rounded-full bg-emerald-500" />

                  </span>

                  <div>
                    <p className="text-[11px] font-bold text-slate-900">
                      Desktop Agent
                    </p>

                    <p className="text-[10px] text-slate-500">
                      Ready to print
                    </p>
                  </div>

                </div>

                {/* ==================================================
                    PRINTER ICON
                ================================================== */}
                <div className="absolute -right-4 top-10 hidden h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-xl sm:flex">

                  <svg
                    className="h-6 w-6 text-emerald-700"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="6 9 6 2 18 2 18 9" />

                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />

                    <rect
                      x="6"
                      y="14"
                      width="12"
                      height="8"
                      rx="1"
                    />
                  </svg>

                </div>

              </div>
            </div>

          </div>
        </section>

        {/* ============================================================
            FEATURES
        ============================================================ */}
        <section
          id="features"
          className="scroll-mt-20 border-t border-slate-200/60 bg-white/70"
        >

          <div className="mx-auto w-full max-w-[1480px] px-7 py-20 sm:px-8 lg:px-10 lg:py-24 xl:px-12 2xl:px-14">

            <div className="max-w-2xl">

              <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
                Built for print shops
              </p>

              <h2 className="text-3xl font-black tracking-[-0.035em] text-slate-950 sm:text-4xl">
                Everything you need to run the counter.
              </h2>

              <p className="mt-4 text-sm leading-6 text-slate-500 sm:text-base">
                SmartPrinter handles the queue, payments, and hardware so you
                can focus on your customers.
              </p>

            </div>

            {/* Feature cards */}
            <div className="mt-10 grid gap-5 md:grid-cols-3">

              {/* ==================================================
                  AUTO SCALING
              ================================================== */}
              <button
                type="button"
                onClick={handleGetStarted}
                className="group cursor-pointer rounded-3xl border border-slate-200 bg-white p-7 text-left shadow-sm transition-all duration-300 hover:-translate-y-2 hover:border-emerald-200 hover:shadow-2xl hover:shadow-slate-200/60"
              >

                <div className="flex items-start justify-between">

                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 transition-all duration-300 group-hover:scale-110 group-hover:bg-emerald-100">

                    <svg
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21.5 2v6h-6" />
                      <path d="M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                    </svg>

                  </div>

                  <span className="text-xl text-slate-300 transition-all duration-200 group-hover:translate-x-1 group-hover:text-emerald-600">
                    →
                  </span>

                </div>

                <h3 className="mt-6 text-lg font-extrabold text-slate-950">
                  Auto-scaling
                </h3>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Jobs queue intelligently across all connected printers
                  without manual intervention.
                </p>

              </button>

              {/* ==================================================
                  SECURE PAYMENTS
              ================================================== */}
              <button
                type="button"
                onClick={handleGetStarted}
                className="group cursor-pointer rounded-3xl border border-slate-200 bg-white p-7 text-left shadow-sm transition-all duration-300 hover:-translate-y-2 hover:border-emerald-200 hover:shadow-2xl hover:shadow-slate-200/60"
              >

                <div className="flex items-start justify-between">

                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 transition-all duration-300 group-hover:scale-110 group-hover:bg-emerald-100">

                    <svg
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>

                  </div>

                  <span className="text-xl text-slate-300 transition-all duration-200 group-hover:translate-x-1 group-hover:text-emerald-600">
                    →
                  </span>

                </div>

                <h3 className="mt-6 text-lg font-extrabold text-slate-950">
                  Secure Payments
                </h3>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Built-in card and contactless payment flow with instant
                  settlement to your account.
                </p>

              </button>

              {/* ==================================================
                  MULTI PRINTER
              ================================================== */}
              <button
                type="button"
                onClick={handleGetStarted}
                className="group cursor-pointer rounded-3xl border border-slate-200 bg-white p-7 text-left shadow-sm transition-all duration-300 hover:-translate-y-2 hover:border-emerald-200 hover:shadow-2xl hover:shadow-slate-200/60"
              >

                <div className="flex items-start justify-between">

                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 transition-all duration-300 group-hover:scale-110 group-hover:bg-emerald-100">

                    <svg
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="6 9 6 2 18 2 18 9" />

                      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />

                      <rect
                        x="6"
                        y="14"
                        width="12"
                        height="8"
                        rx="1"
                      />
                    </svg>

                  </div>

                  <span className="text-xl text-slate-300 transition-all duration-200 group-hover:translate-x-1 group-hover:text-emerald-600">
                    →
                  </span>

                </div>

                <h3 className="mt-6 text-lg font-extrabold text-slate-950">
                  Multi-printer support
                </h3>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Pair any number of networked printers and manage them from a
                  single dashboard.
                </p>

              </button>

            </div>
          </div>
        </section>

        {/* ============================================================
            HOW IT WORKS
        ============================================================ */}
        <section
          id="how-it-works"
          className="scroll-mt-20 mx-auto w-full max-w-[1480px] px-7 py-20 sm:px-8 lg:px-10 lg:py-24 xl:px-12 2xl:px-14"
        >

          <div className="relative overflow-hidden rounded-[2.5rem] border border-slate-200 bg-[#f1f2f5] px-7 py-12 sm:px-10 lg:px-14 lg:py-14">

            {/* Background glow */}
            <div className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full bg-emerald-100/60 blur-3xl" />

            <div className="pointer-events-none absolute -bottom-32 -left-32 h-72 w-72 rounded-full bg-blue-100/40 blur-3xl" />

            <div className="relative">

              <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
                Simple setup
              </p>

              <h2 className="text-3xl font-black tracking-[-0.035em] text-slate-950 sm:text-4xl">
                Up and running in three steps.
              </h2>

              {/* Steps */}
              <div className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">

                {/* STEP 1 */}
                <div className="group">

                  <div className="flex items-center gap-4">

                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#087f4b] text-lg font-black text-white shadow-lg shadow-emerald-900/15 transition-all duration-300 group-hover:-translate-y-1 group-hover:scale-105">
                      1
                    </div>

                    <div className="hidden h-px flex-1 bg-slate-300 md:block" />

                  </div>

                  <h3 className="mt-6 text-lg font-extrabold text-slate-950">
                    Install the Agent
                  </h3>

                  <p className="mt-2 max-w-xs text-sm leading-6 text-slate-500">
                    Drop the SmartPrinter app onto any machine near your
                    printers.
                  </p>

                </div>

                {/* STEP 2 */}
                <div className="group">

                  <div className="flex items-center gap-4">

                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#087f4b] text-lg font-black text-white shadow-lg shadow-emerald-900/15 transition-all duration-300 group-hover:-translate-y-1 group-hover:scale-105">
                      2
                    </div>

                    <div className="hidden h-px flex-1 bg-slate-300 md:block" />

                  </div>

                  <h3 className="mt-6 text-lg font-extrabold text-slate-950">
                    Pair your Printers
                  </h3>

                  <p className="mt-2 max-w-xs text-sm leading-6 text-slate-500">
                    Discover and connect every printer on your local network
                    in seconds.
                  </p>

                </div>

                {/* STEP 3 */}
                <div className="group">

                  <div className="flex items-center gap-4">

                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#087f4b] text-lg font-black text-white shadow-lg shadow-emerald-900/15 transition-all duration-300 group-hover:-translate-y-1 group-hover:scale-105">
                      3
                    </div>

                  </div>

                  <h3 className="mt-6 text-lg font-extrabold text-slate-950">
                    Start Taking Orders
                  </h3>

                  <p className="mt-2 max-w-xs text-sm leading-6 text-slate-500">
                    Customers upload, pay, and collect — you just watch the
                    queue fill up.
                  </p>

                </div>

              </div>

              {/* Bottom CTA */}
              <div className="mt-12 flex flex-col justify-between gap-5 border-t border-slate-300/70 pt-8 sm:flex-row sm:items-center">

                <p className="text-sm font-medium text-slate-500">
                  Ready to turn your shop into a smart printing kiosk?
                </p>

                <button
                  type="button"
                  onClick={handleGetStarted}
                  className="group inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-950 px-6 py-3 text-sm font-bold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-800"
                >
                  Get Started

                  <span className="transition-transform group-hover:translate-x-1">
                    →
                  </span>

                </button>

              </div>

            </div>
          </div>
        </section>

      </main>

      {/* ============================================================
          FOOTER
      ============================================================ */}
      <footer className="border-t border-slate-200/70 bg-white/60">

        <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5 px-7 py-8 text-xs text-slate-500 sm:px-8 sm:flex-row sm:items-center sm:justify-between lg:px-10 xl:px-12 2xl:px-14">

          {/* Brand */}
          <button
            type="button"
            onClick={scrollToTop}
            className="flex cursor-pointer items-center gap-2 font-bold text-slate-800"
          >
            <span className="h-2.5 w-2.5 rounded-full bg-[#087f4b]" />

            <span>
              Smart Printer
            </span>
          </button>

          {/* Links */}
          <div className="flex items-center gap-5">

            <button
              type="button"
              onClick={scrollToFeatures}
              className="cursor-pointer transition-colors hover:text-slate-900"
            >
              Features
            </button>

            <button
              type="button"
              onClick={scrollToHowItWorks}
              className="cursor-pointer transition-colors hover:text-slate-900"
            >
              How it works
            </button>

            <button
              type="button"
              onClick={handleLogin}
              className="cursor-pointer transition-colors hover:text-slate-900"
            >
              Login
            </button>

          </div>

          {/* Copyright */}
          <p>
            © 2026 SmartPrinter Inc. All rights reserved.
          </p>

        </div>
      </footer>

    </div>
  );
}