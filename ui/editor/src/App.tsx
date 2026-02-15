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
import { useState, useEffect } from "react";
import { Moon, Sun, LogOut } from "lucide-react";
import { EDITOR_URL, api } from "@wfm/shared";
import { WorkflowStartPage } from "@/features/start/WorkflowStartPage";
import { WorkflowEditorPage } from "@/features/editor/WorkflowEditorPage";
import { ReactFlowStressPocPage } from "@/poc/reactflow/StressPocPage";
import { SchemaBuilderMonacoPocPage } from "@/poc/monaco/SchemaBuilderMonacoPocPage";
import { DndKitPocPage } from "@/poc/ux-schema-editor/DndKitPocPage";
import { PragmaticDndPocPage } from "@/poc/ux-schema-editor/PragmaticDndPocPage";
import { UxPalettePocPage } from "@/poc/ux-schema-editor/UxPalettePocPage";
import { TreeModesPocPage } from "@/poc/ux-schema-editor/TreeModesPocPage";
import { CustomTreeSchemaPocPage } from "@/poc/json-schema-editor/CustomTreeSchemaPocPage";
import { TemplateFlowSchemaPocPage } from "@/poc/json-schema-editor/TemplateFlowSchemaPocPage";
import { GridSchemaPocPage } from "@/poc/json-schema-editor/GridSchemaPocPage";

import { useTheme } from "@/components/theme-provider";

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
          <Route path="/" element={<WorkflowStartPage />} />
          <Route path="/workflow/new" element={<WorkflowEditorPage />} />
          <Route
            path="/workflow/:workflowTemplateId"
            element={<WorkflowEditorPage />}
          />
          <Route
            path="/workflow/:workflowTemplateId/:workflowVersionId"
            element={<WorkflowEditorPage />}
          />
          <Route
            path="/poc/reactflow/stress"
            element={<ReactFlowStressPocPage />}
          />

          <Route
            path="/poc/monaco/schema-builder"
            element={<SchemaBuilderMonacoPocPage />}
          />
          <Route
            path="/poc/json-schema/custom-tree"
            element={<CustomTreeSchemaPocPage />}
          />
          <Route
            path="/poc/json-schema/template-flow"
            element={<TemplateFlowSchemaPocPage />}
          />
          <Route path="/poc/json-schema/grid" element={<GridSchemaPocPage />} />
          <Route
            path="/poc/ux-schema/dnd-kit"
            element={<DndKitPocPage />}
          />
          <Route
            path="/poc/ux-schema/pragmatic"
            element={<PragmaticDndPocPage />}
          />
          <Route
            path="/poc/ux-schema/palette"
            element={<UxPalettePocPage />}
          />
          <Route
            path="/poc/ux-schema/tree-modes"
            element={<TreeModesPocPage />}
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
