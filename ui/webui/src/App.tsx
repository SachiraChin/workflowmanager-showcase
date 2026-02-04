import { useState, useEffect, useCallback } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useParams,
} from "react-router-dom";
import { Header } from "@/components/layout/header";
import { Loader2 } from "lucide-react";
import { WorkflowStartPage } from "@/pages/WorkflowStartPage";
import { WorkflowRunnerPage } from "@/pages/WorkflowRunnerPage";
import { LoginPage } from "@/pages/LoginPage";
import { api, setAccessDeniedHandler } from "@/core/api";
import { useWorkflowExecution } from "@/state/hooks/useWorkflowExecution";
import { useWorkflowStore } from "@/state/workflow-store";

interface User {
  user_id: string;
  email: string;
  username: string;
}

// =============================================================================
// Route Components (with navigation wiring)
// =============================================================================

function StartPageRoute() {
  const navigate = useNavigate();

  const handleWorkflowStarted = useCallback(
    (workflowRunId: string) => {
      navigate(`/run/${workflowRunId}`);
    },
    [navigate]
  );

  return <WorkflowStartPage onWorkflowStarted={handleWorkflowStarted} />;
}

function RunnerPageRoute() {
  const navigate = useNavigate();
  const { runId } = useParams<{ runId: string }>();
  const { workflowRunId, resumeWorkflow } = useWorkflowExecution();
  const accessDenied = useWorkflowStore((s) => s.accessDenied);

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
    return <Navigate to="/" replace />;
  }

  const handleRestart = useCallback(() => {
    navigate("/");
  }, [navigate]);

  return <WorkflowRunnerPage onRestart={handleRestart} />;
}

// =============================================================================
// Main App Component
// =============================================================================

function AppContent({ user, onLogout }: { user: User; onLogout: () => void }) {
  // Key to force re-render when debug mode changes
  const [refreshKey, setRefreshKey] = useState(0);

  // Handle debug mode toggle - increment key to force remount of all components
  const handleDebugModeChange = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <Header user={user} onLogout={onLogout} onDebugModeChange={handleDebugModeChange} />
      <main key={refreshKey} className="flex-1 min-h-0 overflow-hidden">
        <Routes>
          <Route path="/" element={<StartPageRoute />} />
          <Route path="/run/:runId" element={<RunnerPageRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Get store actions for global 403 handling
  const reset = useWorkflowStore((s) => s.reset);
  const setAccessDenied = useWorkflowStore((s) => s.setAccessDenied);

  // Register global 403 handler once on mount
  useEffect(() => {
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

  const handleLoginSuccess = useCallback((loggedInUser: User) => {
    setUser(loggedInUser);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Ignore errors - we'll clear local state anyway
    }
    setUser(null);
  }, []);

  // Show loading while checking auth
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Show login page if not authenticated
  if (!user) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  // Authenticated - show app with routing
  return (
    <BrowserRouter>
      <AppContent user={user} onLogout={handleLogout} />
    </BrowserRouter>
  );
}

export default App;
