import { lazy, Suspense, useState, useEffect, useCallback, type ReactNode } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useParams,
  useLocation,
  Outlet,
} from "react-router-dom";
import { Header } from "@/components/layout/header";
import { Loader2 } from "lucide-react";
import { api, setAccessDeniedHandler } from "@/core/api";
import { useWorkflowExecution, setCapabilities } from "@/state/hooks/useWorkflowExecution";
import { useWorkflowStore } from "@/state/workflow-store";
import { WEBUI_CAPABILITIES } from "@/lib/capabilities";

const WorkflowStartPage = lazy(() =>
  import("@/pages/WorkflowStartPage").then((module) => ({
    default: module.WorkflowStartPage,
  }))
);
const WorkflowRunnerPage = lazy(() =>
  import("@/pages/WorkflowRunnerPage").then((module) => ({
    default: module.WorkflowRunnerPage,
  }))
);
const LoginPage = lazy(() =>
  import("@/pages/LoginPage").then((module) => ({
    default: module.LoginPage,
  }))
);
const InvitationSignupPage = lazy(() =>
  import("@/pages/InvitationSignupPage").then((module) => ({
    default: module.InvitationSignupPage,
  }))
);
const LandingPage = lazy(() =>
  import("@/pages/landing/LandingPage").then((module) => ({
    default: module.LandingPage,
  }))
);
const RunnerGuideButton = lazy(() =>
  import("@/features/workflow-guidance").then((module) => ({
    default: module.RunnerGuideButton,
  }))
);

interface User {
  user_id: string;
  email?: string | null;
  username: string;
  role?: string | null;
}

function RouteLoadingFallback() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

// =============================================================================
// Route Components (with navigation wiring)
// =============================================================================

function StartPageRoute({ user }: { user: User }) {
  const navigate = useNavigate();

  const handleWorkflowStarted = useCallback(
    (workflowRunId: string) => {
      navigate(`/run/${workflowRunId}`);
    },
    [navigate]
  );

  return <WorkflowStartPage onWorkflowStarted={handleWorkflowStarted} user={user} />;
}

function RunnerPageRoute() {
  const navigate = useNavigate();
  const { runId } = useParams<{ runId: string }>();
  const { workflowRunId, resumeWorkflow } = useWorkflowExecution();
  const accessDenied = useWorkflowStore((s) => s.accessDenied);
  const handleRestart = useCallback(() => {
    navigate("/workflows");
  }, [navigate]);

  // If we have a runId in URL but not in store, try to resume
  // Skip if access was denied (prevents infinite loop on 403)
  useEffect(() => {
    if (runId && runId !== workflowRunId && !accessDenied) {
      // Resume with the run ID from URL
      // Project name will be fetched from server when stream connects
      resumeWorkflow(runId, "Resuming...");
    }
  }, [runId, workflowRunId, resumeWorkflow, accessDenied]);

  // If no runId in URL, redirect to start
  if (!runId) {
    return <Navigate to="/workflows" replace />;
  }

  return <WorkflowRunnerPage onRestart={handleRestart} />;
}

// =============================================================================
// Layouts
// =============================================================================

function AuthenticatedLayout({ user, onLogout }: { user: User; onLogout: () => void }) {
  const location = useLocation();
  // Key to force re-render when debug mode changes
  const [refreshKey, setRefreshKey] = useState(0);

  // Handle debug mode toggle - increment key to force remount of all components
  const handleDebugModeChange = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  // Show guide button only on runner page (/run/*)
  const isRunnerPage = location.pathname.startsWith("/run/");

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <Header
        user={user}
        onLogout={onLogout}
        onDebugModeChange={handleDebugModeChange}
        showGuideButton={isRunnerPage}
        guideButton={(
          <Suspense fallback={null}>
            <RunnerGuideButton />
          </Suspense>
        )}
      />
      <main key={refreshKey} className="flex-1 min-h-0 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

function RequireAuth({
  user,
  isCheckingAuth,
  children,
}: {
  user: User | null;
  isCheckingAuth: boolean;
  children: ReactNode;
}) {
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Get store actions for global 403 handling
  const reset = useWorkflowStore((s) => s.reset);
  const setAccessDenied = useWorkflowStore((s) => s.setAccessDenied);

  // Register global 403 handler and set capabilities once on mount
  useEffect(() => {
    // Set WebUI capabilities for the shared package
    setCapabilities(WEBUI_CAPABILITIES);
    
    setAccessDeniedHandler(() => {
      // Clear workflow state and show access denied view
      reset();
      setAccessDenied(true);
    });
  }, [reset, setAccessDenied]);

  // Check if user is already logged in on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const currentUser = await api.getCurrentUser();
        setUser(currentUser);
      } catch {
        // Not logged in or token expired
        setUser(null);
      } finally {
        setIsCheckingAuth(false);
      }
    };
    checkAuth();
  }, []);

  const handleLoginSuccess = useCallback(
    (loggedInUser: User) => {
      setUser(loggedInUser);
      navigate("/workflows");
    },
    [navigate]
  );

  const handleLogout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Ignore errors - we'll clear local state anyway
    }
    setUser(null);
  }, []);

  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route
          path="/login"
          element={user ? <Navigate to="/workflows" replace /> : <LoginPage onLoginSuccess={handleLoginSuccess} />}
        />
        <Route path="/invite" element={<InvitationSignupPage onLoginSuccess={handleLoginSuccess} />} />
        <Route path="/invite/:invitationCode" element={<InvitationSignupPage onLoginSuccess={handleLoginSuccess} />} />
        <Route path="/invite/*" element={<InvitationSignupPage onLoginSuccess={handleLoginSuccess} />} />
        <Route
          element={(
            <RequireAuth user={user} isCheckingAuth={isCheckingAuth}>
              <AuthenticatedLayout user={user as User} onLogout={handleLogout} />
            </RequireAuth>
          )}
        >
          <Route path="/workflows" element={<StartPageRoute user={user as User} />} />
          <Route path="/run/:runId" element={<RunnerPageRoute />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
