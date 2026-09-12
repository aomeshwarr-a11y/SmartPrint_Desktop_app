
import { useNavigate } from "react-router-dom";

export default function Welcome() {
  const navigate = useNavigate();

  return (
    <div className="flex h-screen w-screen flex-col bg-white select-none overflow-hidden font-sans antialiased text-[#0f172a]">
      {/* 1. TOP HEADER */}
      <header className="flex h-16 w-full items-center justify-between border-b border-slate-200 px-8 shrink-0 bg-white">
        {/* Brand Logo & Name */}
        <div className="flex items-center gap-3">
          <svg className="h-6 w-6 text-[#0062d2]" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z" />
          </svg>
          <span className="text-xl font-bold tracking-tight text-[#0b1e36]">SmartPrinter</span>
        </div>

        {/* Online Status Indicator */}
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span>Online</span>
        </div>
      </header>

      {/* 2. MAIN TWO-COLUMN CONTAINER */}
      <main className="flex flex-1 w-full min-h-0">
        {/* LEFT COLUMN: ARCHITECTURE WORKFLOW */}
        <section className="relative flex flex-1 items-center justify-center bg-[#f8fafc] p-10 border-r border-slate-100 overflow-hidden">
          {/* Subtle Radial Backlight behind workstation */}
          <div
            className="absolute h-80 w-80 rounded-full pointer-events-none opacity-40 blur-3xl"
            style={{
              background: "radial-gradient(circle, rgba(186, 230, 253, 0.8) 0%, rgba(240, 249, 255, 0) 70%)",
            }}
          />

          {/* Workflow Diagram: Cloud -> SmartPrinter Desktop -> Printer */}
          <div className="relative z-10 flex items-center justify-center gap-6 lg:gap-8 max-w-xl">
            {/* Cloud Icon & Label */}
            <div className="flex flex-col items-center">
              <div className="flex h-16 w-16 items-center justify-center text-[#1e293b]">
                <svg
                  className="h-12 w-12 stroke-[#1e293b] fill-none"
                  viewBox="0 0 24 24"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                </svg>
              </div>
              <span className="mt-3 text-sm font-medium text-[#1e293b]">Cloud</span>
            </div>

            {/* Connecting Arrow 1 */}
            <div className="text-slate-400 -mt-6">
              <svg
                className="h-6 w-10 stroke-slate-400 fill-none"
                viewBox="0 0 40 20"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 12 C 16 6, 24 6, 36 12" />
                <path d="M30 7 L 36 12 L 31 16" />
              </svg>
            </div>

            {/* Desktop Workstation & Label */}
            <div className="flex flex-col items-center">
              <div className="flex h-16 items-center justify-center text-[#1e293b] gap-1.5">
                {/* Computer Tower */}
                <div className="w-5 h-12 rounded-xs border-2 border-[#1e293b] bg-[#1e293b] flex flex-col items-center justify-around py-1">
                  <span className="w-2.5 h-0.5 bg-slate-400 rounded-full" />
                  <span className="w-2.5 h-0.5 bg-slate-400 rounded-full" />
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                </div>
                {/* Monitor */}
                <div className="flex flex-col items-center">
                  <div className="w-12 h-9 rounded-xs border-2 border-[#1e293b] bg-white flex items-center justify-center">
                    <div className="w-9 h-6 bg-[#f1f5f9] rounded-xs" />
                  </div>
                  <div className="w-1.5 h-2 bg-[#1e293b]" />
                  <div className="w-6 h-1 bg-[#1e293b] rounded-full" />
                </div>
              </div>
              <div className="mt-3 text-center text-sm font-medium text-[#1e293b] leading-tight">
                <div>SmartPrinter</div>
                <div>Desktop</div>
              </div>
            </div>

            {/* Connecting Arrow 2 */}
            <div className="text-slate-400 -mt-6">
              <svg
                className="h-6 w-10 stroke-slate-400 fill-none"
                viewBox="0 0 40 20"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 12 C 16 6, 24 6, 36 12" />
                <path d="M30 7 L 36 12 L 31 16" />
              </svg>
            </div>

            {/* Printer Icon & Label */}
            <div className="flex flex-col items-center">
              <div className="flex h-16 w-16 items-center justify-center text-[#1e293b]">
                <svg className="h-11 w-11 fill-[#1e293b]" viewBox="0 0 24 24">
                  <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z" />
                </svg>
              </div>
              <span className="mt-3 text-sm font-medium text-[#1e293b]">Printer</span>
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: ONBOARDING ACTIONS */}
        <section className="flex flex-1 flex-col items-start justify-center bg-white px-12 lg:px-20 py-10">
          <div className="w-full max-w-[460px]">
            {/* Two-line Bold Navy Headline */}
            <h1 className="text-4xl lg:text-[44px] font-extrabold tracking-tight text-[#0b1e36] leading-[1.15]">
              Welcome to<br />SmartPrinter
            </h1>

            {/* Description */}
            <p className="mt-4 text-base lg:text-[17px] leading-relaxed text-slate-600">
              Connect your printer and automate your print jobs — securely, reliably, and effortlessly.
            </p>

            {/* Feature Row with 3 Icons */}
            <div className="mt-8 flex items-start justify-between text-center">
              {/* Feature 1: Quick setup */}
              <div className="flex flex-col items-center">
                <svg className="h-6 w-6 text-slate-500 stroke-current fill-none" viewBox="0 0 24 24" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <div className="mt-2 text-xs leading-snug font-medium text-slate-500">
                  <div>Quick</div>
                  <div>setup</div>
                </div>
              </div>

              {/* Feature 2: Automatic printing */}
              <div className="flex flex-col items-center">
                <svg className="h-6 w-6 text-slate-500 stroke-current fill-none" viewBox="0 0 24 24" strokeWidth="1.8">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
                <div className="mt-2 text-xs leading-snug font-medium text-slate-500">
                  <div>Automatic</div>
                  <div>printing</div>
                </div>
              </div>

              {/* Feature 3: Secure connection */}
              <div className="flex flex-col items-center">
                <svg className="h-6 w-6 text-slate-500 stroke-current fill-none" viewBox="0 0 24 24" strokeWidth="1.8">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <div className="mt-2 text-xs leading-snug font-medium text-slate-500">
                  <div>Secure</div>
                  <div>connection</div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-10 flex flex-col items-center">
              {/* Primary Pill Button */}
              <button
                type="button"
                onClick={() => navigate("/signup")}
                className="w-full h-14 rounded-full bg-[#0062d2] text-white text-base font-semibold shadow-sm hover:bg-[#0052b3] active:scale-[0.99] transition-all cursor-pointer"
              >
                Get Started
              </button>

              {/* Secondary Link Action */}
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="mt-4 text-sm font-medium text-[#0070e0] hover:underline cursor-pointer"
              >
                Sign In
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}