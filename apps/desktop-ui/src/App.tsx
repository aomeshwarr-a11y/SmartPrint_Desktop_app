import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { supabase } from "./lib/supabaseClient";
import { getServiceStatus } from "./lib/ipc";

import Layout from "./components/Layout";

import Welcome from "./pages/Welcome";
import Login from "./pages/Login";
import Signup from "./pages/Signup";

import ShopSetup from "./pages/ShopSetup";
import DevicePairing from "./pages/DevicePairing";

import SubscriptionStatus from "./pages/SubscriptionStatus";
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
          <p className="text-sm font-semibold tracking-tight text-white">
            SmartPrinter
          </p>

          <p className="text-xs text-slate-400">
            Restoring session...
          </p>
        </div>
      </div>
    </div>
  );
}


/**
 * ============================================================
 * ONBOARDING STATE
 * ============================================================
 *
 * Determines where an authenticated user should go:
 *
 * No shop
 *    -> /shop-setup
 *
 * Shop exists but no active device
 *    -> /pairing
 *
 * Shop + active device
 *    -> /dashboard
 */
type OnboardingState =
  | "loading"
  | "shop_setup"
  | "device_pairing"
  | "complete"
  | "error";


function useOnboardingState() {
  const { session, loading: authLoading, ensureDesktopUserRole } = useAuth();

  const [state, setState] = useState<OnboardingState>("loading");

  useEffect(() => {
    let cancelled = false;

    async function checkOnboarding() {
      if (authLoading) {
        return;
      }

      if (!session?.user) {
        if (!cancelled) {
          setState("complete");
        }

        return;
      }

      if (!cancelled) {
        setState("loading");
      }

      try {
        // Ensure the desktop user has the shop_owner role assigned idempotently
        await ensureDesktopUserRole().catch(() => {});

        /*
         * ------------------------------------------------------
         * STEP 1: Determine whether the user has a branch or is an admin.
         * ------------------------------------------------------
         */
        const user = session.user;
        let activeBranchId: string | null = null;

        // Determine whether user is a platform admin using existing application mechanism
        let isAdmin = false;
        try {
          const { data: adminRpc } = await supabase.rpc("is_admin");
          if (adminRpc === true) {
            isAdmin = true;
          }
        } catch {
          // RPC may fail if unauthenticated or network error, fallback to false
        }

        // 1. Check branches where user is owner or manager
        const { data: ownedBranch, error: branchError } = await supabase
          .from("branches")
          .select("id")
          .or(`owner_id.eq.${user.id},manager_id.eq.${user.id}`)
          .limit(1)
          .maybeSingle();

        if (branchError) {
          console.error(
            "Failed to check SmartPrinter branch onboarding:",
            branchError
          );

          if (!cancelled) {
            setState("error");
          }

          return;
        }

        if (ownedBranch?.id) {
          activeBranchId = ownedBranch.id;
        } else {
          // 2. Check user_roles table for branch membership
          const { data: roleRow, error: roleError } = await supabase
            .from("user_roles")
            .select("branch_id")
            .eq("user_id", user.id)
            .in("role", ["branch", "branch_owner", "shop_owner"])
            .limit(1)
            .maybeSingle();

          if (roleError) {
            console.error(
              "Failed to check SmartPrinter user roles:",
              roleError
            );

            if (!cancelled) {
              setState("error");
            }

            return;
          }

          if (roleRow?.branch_id) {
            activeBranchId = roleRow.branch_id;
          }
        }

        // 3. If admin has no direct branch or role assignment, allow access to first branch
        if (!activeBranchId && isAdmin) {
          const { data: adminBranch } = await supabase
            .from("branches")
            .select("id")
            .limit(1)
            .maybeSingle();

          if (adminBranch?.id) {
            activeBranchId = adminBranch.id;
          }
        }

        /*
         * No branch found means this is a new user who has not
         * completed Branch/Shop Setup yet.
         */
        if (!activeBranchId) {
          if (!cancelled) {
            setState("shop_setup");
          }

          return;
        }

        /*
         * ------------------------------------------------------
         * STEP 2: Check whether this station has an active desktop agent.
         * ------------------------------------------------------
         * First, check local desktop agent via IPC (fast & authoritative for this machine).
         */
        const localStatus = await getServiceStatus().catch(() => null);
        if (localStatus?.isPaired) {
          if (!cancelled) {
            setState("complete");
          }
          return;
        }

        /*
         * Check cloud desktop_agents (new Desktop Agent architecture) for this branch.
         */
        let hasActiveAgent = false;
        try {
          const { data: activeAgent } = await supabase
            .from("desktop_agents")
            .select("id")
            .eq("branch_id", activeBranchId)
            .eq("status", "active")
            .limit(1)
            .maybeSingle();

          if (activeAgent?.id) {
            hasActiveAgent = true;
          }
        } catch {
          // Non-blocking fallback
        }

        /*
         * Branch exists, but no active agent exists.
         *
         * Send the user to Device Pairing.
         */
        if (!hasActiveAgent) {
          if (!cancelled) {
            setState("device_pairing");
          }

          return;
        }

        /*
         * ------------------------------------------------------
         * ONBOARDING COMPLETE
         * ------------------------------------------------------
         */
        if (!cancelled) {
          setState("complete");
        }
      } catch (error) {
        console.error(
          "Unexpected SmartPrinter onboarding check error:",
          error
        );

        if (!cancelled) {
          setState("error");
        }
      }
    }

    void checkOnboarding();

    return () => {
      cancelled = true;
    };
  }, [session, authLoading]);

  return {
    session,
    authLoading,
    state,
  };
}


/**
 * ============================================================
 * INITIAL ENTRY ROUTE
 * ============================================================
 *
 * Electron starts
 *      ↓
 * Restore Supabase session
 *      ↓
 * Authenticated?
 *
 * YES
 *      ↓
 * Check onboarding
 *      ↓
 * Shop Setup / Pairing / Dashboard
 *
 * NO
 *      ↓
 * Welcome
 */
function InitialAuthRoute() {
  const {
    session,
    authLoading,
    state,
  } = useOnboardingState();

  if (authLoading || (session && state === "loading")) {
    return <AuthLoadingScreen />;
  }

  /*
   * No authenticated user.
   */
  if (!session) {
    return <Navigate to="/welcome" replace />;
  }

  /*
   * New user: Shop Setup has not been completed.
   */
  if (state === "shop_setup") {
    return <Navigate to="/shop-setup" replace />;
  }

  /*
   * Shop exists but device has not been paired.
   */
  if (state === "device_pairing") {
    return <Navigate to="/pairing" replace />;
  }

  /*
   * If the onboarding check fails, don't blindly send the
   * user to Dashboard. Send them to Shop Setup where the
   * existing shop can be loaded/repaired.
   */
  if (state === "error") {
    return <Navigate to="/shop-setup" replace />;
  }

  /*
   * Shop + active device exist.
   */
  return <Navigate to="/dashboard" replace />;
}


/**
 * ============================================================
 * BASIC AUTH GUARD
 * ============================================================
 */
function RequireAuth({
  children,
}: {
  children: JSX.Element;
}) {
  const { session, loading } = useAuth();

  if (loading) {
    return <AuthLoadingScreen />;
  }

  if (!session) {
    return <Navigate to="/welcome" replace />;
  }

  return children;
}


/**
 * ============================================================
 * ONBOARDING GUARD
 * ============================================================
 *
 * Prevents users from manually typing:
 *
 * /dashboard
 * /printers
 * /settings
 * etc.
 *
 * before they finish Shop Setup + Device Pairing.
 */
function RequireCompletedOnboarding({
  children,
}: {
  children: JSX.Element;
}) {
  const {
    session,
    authLoading,
    state,
  } = useOnboardingState();

  if (authLoading || (session && state === "loading")) {
    return <AuthLoadingScreen />;
  }

  if (!session) {
    return <Navigate to="/welcome" replace />;
  }

  if (state === "shop_setup") {
    return <Navigate to="/shop-setup" replace />;
  }

  if (state === "device_pairing") {
    return <Navigate to="/pairing" replace />;
  }

  if (state === "error") {
    return <Navigate to="/shop-setup" replace />;
  }

  return children;
}


/**
 * ============================================================
 * APP ROUTES
 * ============================================================
 */
export default function App() {
  return (
    <Routes>

      {/* ======================================================
          ROOT
          ====================================================== */}
      <Route
        path="/"
        element={<InitialAuthRoute />}
      />


      {/* ======================================================
          AUTH ROUTES
          ====================================================== */}
      <Route
        path="/login"
        element={<Login />}
      />

      <Route
        path="/signup"
        element={<Signup />}
      />

      <Route
        path="/welcome"
        element={<Welcome />}
      />


      {/* ======================================================
          ONBOARDING STEP 1
          ====================================================== */}
      <Route
        path="/shop-setup"
        element={
          <RequireAuth>
            <ShopSetup />
          </RequireAuth>
        }
      />


      {/* ======================================================
          ONBOARDING STEP 2
          ====================================================== */}
      <Route
        path="/pairing"
        element={
          <RequireAuth>
            <DevicePairing />
          </RequireAuth>
        }
      />


      {/* ======================================================
          COMPLETED APPLICATION
          ======================================================
          
          Everything inside Layout requires:

          1. Authenticated Supabase session
          2. Shop exists
          3. Active paired device exists
          ====================================================== */}
      <Route
        element={
          <RequireCompletedOnboarding>
            <Layout />
          </RequireCompletedOnboarding>
        }
      >
        <Route
          path="/dashboard"
          element={<Dashboard />}
        />

        <Route
          path="/subscription"
          element={<SubscriptionStatus />}
        />

        <Route
          path="/printers"
          element={<PrinterDiscovery />}
        />

        <Route
          path="/printers/authorize"
          element={<PrinterAuthorization />}
        />

        <Route
          path="/printers/status"
          element={<PrinterStatusPage />}
        />

        <Route
          path="/qr"
          element={<QrCode />}
        />

        <Route
          path="/jobs/active"
          element={<ActiveJobs />}
        />

        <Route
          path="/jobs/history"
          element={<JobHistory />}
        />

        <Route
          path="/settings"
          element={<Settings />}
        />

        <Route
          path="/diagnostics"
          element={<Diagnostics />}
        />

        <Route
          path="/updates"
          element={<UpdateStatus />}
        />

        <Route
          path="/logout"
          element={<Logout />}
        />
      </Route>


      {/* ======================================================
          FALLBACK
          ====================================================== */}
      <Route
        path="*"
        element={<Navigate to="/" replace />}
      />

    </Routes>
  );
}