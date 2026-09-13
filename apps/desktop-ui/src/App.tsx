import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Layout from "./components/Layout";
import Welcome from "./pages/Welcome";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ShopSetup from "./pages/ShopSetup";
import SubscriptionStatus from "./pages/SubscriptionStatus";
import DevicePairing from "./pages/DevicePairing";
import PrinterDiscovery from "./pages/PrinterDiscovery";
import PrinterAuthorization from "./pages/PrinterAuthorization";
import QrCode from "./pages/QrCode";
import Dashboard from "./pages/Dashboard";
import ActiveJobs from "./pages/ActiveJobs";
import JobHistory from "./pages/JobHistory";
import PrinterStatusPage from "./pages/PrinterStatusPage";
import Settings from "./pages/Settings";
import Diagnostics from "./pages/Diagnostics";
import Logout from "./pages/Logout";
import UpdateStatus from "./pages/UpdateStatus";

function AuthLoadingScreen() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#071328] select-none font-sans">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="h-9 w-9 animate-spin rounded-full border-3 border-[#0062d2] border-t-transparent" />
        <div className="space-y-1">
          <p className="text-sm font-semibold tracking-tight text-white">SmartPrinter</p>
          <p className="text-xs text-slate-400">Restoring session...</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Initial entry router (Requirement 3):
 * Start Electron -> Initialize Supabase -> Restore authentication session -> Check authentication state
 * Valid session?
 *   YES -> Dashboard
 *   NO  -> Sign In (/login)
 */
function InitialAuthRoute() {
  const { session, loading } = useAuth();

  if (loading) {
    return <AuthLoadingScreen />;
  }

  if (session) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Navigate to="/login" replace />;
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth();
  if (loading) return <AuthLoadingScreen />;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      {/* Root route: decides between Dashboard and Sign In after session restoration */}
      <Route path="/" element={<InitialAuthRoute />} />

      {/* Auth routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/welcome" element={<Welcome />} />

      {/* Onboarding steps happen outside the main dashboard shell. */}
      <Route
        path="/shop-setup"
        element={
          <RequireAuth>
            <ShopSetup />
          </RequireAuth>
        }
      />
      <Route
        path="/pairing"
        element={
          <RequireAuth>
            <DevicePairing />
          </RequireAuth>
        }
      />

      {/* Everything past pairing lives inside the sidebar shell. */}
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/subscription" element={<SubscriptionStatus />} />
        <Route path="/printers" element={<PrinterDiscovery />} />
        <Route path="/printers/authorize" element={<PrinterAuthorization />} />
        <Route path="/printers/status" element={<PrinterStatusPage />} />
        <Route path="/qr" element={<QrCode />} />
        <Route path="/jobs/active" element={<ActiveJobs />} />
        <Route path="/jobs/history" element={<JobHistory />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/diagnostics" element={<Diagnostics />} />
        <Route path="/updates" element={<UpdateStatus />} />
        <Route path="/logout" element={<Logout />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
