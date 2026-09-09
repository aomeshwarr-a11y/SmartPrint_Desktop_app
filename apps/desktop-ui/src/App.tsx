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

function RequireAuth({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-brand-500">Loading...</div>;
  if (!session) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Welcome />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />

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
