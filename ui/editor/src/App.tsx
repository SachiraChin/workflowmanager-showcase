import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Suspense, lazy, useState, useEffect, type ReactNode } from "react";
import { Moon, Sun, LogOut } from "lucide-react";
import { EDITOR_URL, api } from "@wfm/shared";
import { useTheme } from "@/components/theme-provider";

const WorkflowStartPage = lazy(() =>
  import("@/features/start/WorkflowStartPage").then((module) => ({
    default: module.WorkflowStartPage,
  }))
);
const WorkflowEditorPage = lazy(() =>
  import("@/features/editor/WorkflowEditorPage").then((module) => ({
    default: module.WorkflowEditorPage,
  }))
);
const ReactFlowStressPocPage = lazy(() =>
  import("@/poc/reactflow/StressPocPage").then((module) => ({
    default: module.ReactFlowStressPocPage,
  }))
);
const SchemaBuilderMonacoPocPage = lazy(() =>
  import("@/poc/monaco/SchemaBuilderMonacoPocPage").then((module) => ({
    default: module.SchemaBuilderMonacoPocPage,
  }))
);
const DndKitPocPage = lazy(() =>
  import("@/poc/ux-schema-editor/DndKitPocPage").then((module) => ({
    default: module.DndKitPocPage,
  }))
);
const PragmaticDndPocPage = lazy(() =>
  import("@/poc/ux-schema-editor/PragmaticDndPocPage").then((module) => ({
    default: module.PragmaticDndPocPage,
  }))
);
const UxPalettePocPage = lazy(() =>
  import("@/poc/ux-schema-editor/UxPalettePocPage").then((module) => ({
    default: module.UxPalettePocPage,
  }))
);
const TreeModesPocPage = lazy(() =>
  import("@/poc/ux-schema-editor/TreeModesPocPage").then((module) => ({
    default: module.TreeModesPocPage,
  }))
);
const CustomTreeSchemaPocPage = lazy(() =>
  import("@/poc/json-schema-editor/CustomTreeSchemaPocPage").then((module) => ({
    default: module.CustomTreeSchemaPocPage,
  }))
);
const TemplateFlowSchemaPocPage = lazy(() =>
  import("@/poc/json-schema-editor/TemplateFlowSchemaPocPage").then((module) => ({
    default: module.TemplateFlowSchemaPocPage,
  }))
);
const GridSchemaPocPage = lazy(() =>
  import("@/poc/json-schema-editor/GridSchemaPocPage").then((module) => ({
    default: module.GridSchemaPocPage,
  }))
);

function LazyRoute({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading...</div>}>
      {children}
    </Suspense>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  const toggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  return (
    <button
      className="cursor-pointer rounded-md border bg-card p-2 hover:bg-muted/40"
      onClick={toggleTheme}
      type="button"
      aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
    >
      {resolvedTheme === "dark" ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </button>
  );
}

function UserMenu() {
  const [user, setUser] = useState<{ username: string; role?: string | null } | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    api.getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await api.logout();
      // Redirect to login or home page
      window.location.href = "/";
    } catch {
      // Still redirect even if logout fails
      window.location.href = "/";
    }
  };

  if (!user) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">
        {user.username}
        {user.role === "admin" && (
          <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">(admin)</span>
        )}
      </span>
      <button
        className="cursor-pointer rounded-md border bg-card p-2 hover:bg-muted/40"
        onClick={handleLogout}
        disabled={isLoggingOut}
        type="button"
        title="Logout"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}

function HeaderNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const isWorkflowRoute = location.pathname.startsWith("/workflow/");
  const [openMenu, setOpenMenu] = useState<"poc" | "runtime" | null>(null);

  const closeMenus = () => setOpenMenu(null);

  const toggleMenu = (menu: "poc" | "runtime") => {
    setOpenMenu((current) => (current === menu ? null : menu));
  };

  return (
    <header className="relative z-50 border-b bg-card">
      {/* Development notice banner */}
      <div className="bg-amber-100 dark:bg-amber-900/40 px-4 py-1.5 text-center text-xs text-amber-800 dark:text-amber-200">
        Early Development: Changes are not persisted. Use to preview and explore how modules work.
      </div>
      <div
        className={[
          "flex h-14 items-center px-4",
          isWorkflowRoute ? "justify-end" : "mx-auto max-w-7xl justify-between",
        ].join(" ")}
      >
        {isWorkflowRoute ? (
          <div className="flex items-center gap-2 text-sm">
            <button
              className="cursor-pointer rounded-md border bg-card px-3 py-1.5 hover:bg-muted/40"
              onClick={() => navigate(-1)}
              type="button"
            >
              Back
            </button>
            <Link className="text-sm font-semibold" to="/">
              Workflow Editor
            </Link>
            <div className="flex-1" />
            <ThemeToggle />
            <UserMenu />
          </div>
        ) : (
          <>
            <Link className="text-sm font-semibold" to="/">
              Workflow Editor
            </Link>
            <nav className="flex items-center gap-2 text-sm">
              <UserMenu />
              <ThemeToggle />
              <div className="relative">
                <button
                  className="cursor-pointer rounded-md border bg-card px-3 py-1.5 hover:bg-muted/40"
                  onClick={() => toggleMenu("poc")}
                  type="button"
                >
                  PoCs
                </button>
                {openMenu === "poc" ? (
                  <div className="absolute right-0 z-20 mt-2 w-56 rounded-md border bg-card p-1 shadow-md">
                    <Link
                      className="block rounded px-3 py-2 hover:bg-muted"
                      onClick={closeMenus}
                      to="/poc/reactflow/stress"
                    >
                      Stress PoC
                    </Link>

                    <Link
                      className="block rounded px-3 py-2 hover:bg-muted"
                      onClick={closeMenus}
                      to="/poc/monaco/schema-builder"
                    >
                      Monaco Schema PoC
                    </Link>
                    <Link
                      className="block rounded px-3 py-2 hover:bg-muted font-medium text-primary"
                      onClick={closeMenus}
                      to="/poc/json-schema/custom-tree"
                    >
                      JSON Schema (Custom Tree) ★
                    </Link>
                    <Link
                      className="block rounded px-3 py-2 hover:bg-muted"
                      onClick={closeMenus}
                      to="/poc/json-schema/template-flow"
                    >
                      JSON Schema (Template Flow)
                    </Link>
                    <Link
                      className="block rounded px-3 py-2 hover:bg-muted"
                      onClick={closeMenus}
                      to="/poc/json-schema/grid"
                    >
                      JSON Schema (Grid Library)
                    </Link>
                    <div className="my-1 border-t" />
                    <Link
                      className="block rounded px-3 py-2 hover:bg-muted"
                      onClick={closeMenus}
                      to="/poc/ux-schema/dnd-kit"
                    >
                      UX Schema Editor (dnd-kit)
                    </Link>
                    <Link
                      className="block rounded px-3 py-2 hover:bg-muted"
                      onClick={closeMenus}
                      to="/poc/ux-schema/pragmatic"
                    >
                      UX Schema Editor (Pragmatic)
                    </Link>
                    <Link
                      className="block rounded px-3 py-2 hover:bg-muted font-medium text-primary"
                      onClick={closeMenus}
                      to="/poc/ux-schema/palette"
                    >
                      UX Schema Editor (Palette) ★
                    </Link>
                    <Link
                      className="block rounded px-3 py-2 hover:bg-muted"
                      onClick={closeMenus}
                      to="/poc/ux-schema/tree-modes"
                    >
                      UX Tree Modes PoC
                    </Link>
                  </div>
                ) : null}
              </div>
              <div className="relative">
                <button
                  className="cursor-pointer rounded-md border bg-card px-3 py-1.5 hover:bg-muted/40"
                  onClick={() => toggleMenu("runtime")}
                  type="button"
                >
                  Runtime
                </button>
                {openMenu === "runtime" ? (
                  <div className="absolute right-0 z-20 mt-2 w-72 rounded-md border bg-card p-1 shadow-md">
                    <Link
                      className="block rounded px-3 py-2 hover:bg-muted font-medium text-primary"
                      onClick={closeMenus}
                      to="/runtime/test"
                    >
                      Virtual Runtime Test
                    </Link>
                  </div>
                ) : null}
              </div>
            </nav>
          </>
        )}
      </div>
    </header>
  );
}

function AppShell() {
  return (
    <div className="h-screen min-h-0 bg-background text-foreground">
      <div className="flex h-full min-h-0 flex-col">
        <HeaderNav />
        <main className="flex-1 min-h-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  // Use EDITOR_URL as basename for subdirectory deployment (e.g., /editor in production)
  const basename = EDITOR_URL || undefined;

  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<LazyRoute><WorkflowStartPage /></LazyRoute>} />
          <Route path="/workflow/new" element={<LazyRoute><WorkflowEditorPage /></LazyRoute>} />
          <Route
            path="/workflow/:workflowTemplateId"
            element={<LazyRoute><WorkflowEditorPage /></LazyRoute>}
          />
          <Route
            path="/workflow/:workflowTemplateId/:workflowVersionId"
            element={<LazyRoute><WorkflowEditorPage /></LazyRoute>}
          />
          <Route
            path="/poc/reactflow/stress"
            element={<LazyRoute><ReactFlowStressPocPage /></LazyRoute>}
          />

          <Route
            path="/poc/monaco/schema-builder"
            element={<LazyRoute><SchemaBuilderMonacoPocPage /></LazyRoute>}
          />
          <Route
            path="/poc/json-schema/custom-tree"
            element={<LazyRoute><CustomTreeSchemaPocPage /></LazyRoute>}
          />
          <Route
            path="/poc/json-schema/template-flow"
            element={<LazyRoute><TemplateFlowSchemaPocPage /></LazyRoute>}
          />
          <Route path="/poc/json-schema/grid" element={<LazyRoute><GridSchemaPocPage /></LazyRoute>} />
          <Route
            path="/poc/ux-schema/dnd-kit"
            element={<LazyRoute><DndKitPocPage /></LazyRoute>}
          />
          <Route
            path="/poc/ux-schema/pragmatic"
            element={<LazyRoute><PragmaticDndPocPage /></LazyRoute>}
          />
          <Route
            path="/poc/ux-schema/palette"
            element={<LazyRoute><UxPalettePocPage /></LazyRoute>}
          />
          <Route
            path="/poc/ux-schema/tree-modes"
            element={<LazyRoute><TreeModesPocPage /></LazyRoute>}
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
