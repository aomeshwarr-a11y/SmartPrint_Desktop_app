import { Link } from "react-router-dom";

export default function Welcome() {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-cream px-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 h-14 w-14 rounded-2xl bg-brand-600" />
        <h1 className="text-2xl font-semibold text-brand-900">Welcome to SmartPrinter</h1>
        <p className="mt-2 text-sm text-brand-600">
          Turn the printer you already have into a self-service kiosk for your shop. Log in or create an
          account to get started.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <Link to="/login" className="btn-primary w-full">
            Log in
          </Link>
          <Link to="/signup" className="btn-secondary w-full">
            Create an account
          </Link>
        </div>
      </div>
    </div>
  );
}
