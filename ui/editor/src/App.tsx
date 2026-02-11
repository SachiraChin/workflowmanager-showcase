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
import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { WorkflowStartPage } from "@/features/start/WorkflowStartPage";
import { WorkflowEditorPage } from "@/features/editor/WorkflowEditorPage";
import { ReactFlowStressPocPage } from "@/poc/reactflow/StressPocPage";
import { SchemaBuilderMonacoPocPage } from "@/poc/monaco/SchemaBuilderMonacoPocPage";
import { DndKitPocPage } from "@/poc/ux-schema-editor/DndKitPocPage";
import { PragmaticDndPocPage } from "@/poc/ux-schema-editor/PragmaticDndPocPage";
import { UxPalettePocPage } from "@/poc/ux-schema-editor/UxPalettePocPage";
import { VirtualRuntimeTestPage } from "@/runtime/VirtualRuntimeTestPage";
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

function HeaderNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const isEditorRoute = location.pathname.startsWith("/editor/");
  const [openMenu, setOpenMenu] = useState<"poc" | "runtime" | null>(null);

  const closeMenus = () => setOpenMenu(null);

  const toggleMenu = (menu: "poc" | "runtime") => {
    setOpenMenu((current) => (current === menu ? null : menu));
  };

  return (
    <header className="relative z-50 border-b bg-card">
      <div
        className={[
          "flex h-14 items-center px-4",
          isEditorRoute ? "justify-end" : "mx-auto max-w-7xl justify-between",
        ].join(" ")}
      >
        {isEditorRoute ? (
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
            <ThemeToggle />
          </div>
        ) : (
          <>
            <Link className="text-sm font-semibold" to="/">
              Workflow Editor
            </Link>
            <nav className="flex items-center gap-2 text-sm">
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
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<WorkflowStartPage />} />
          <Route path="/editor/new" element={<WorkflowEditorPage />} />
          <Route
            path="/editor/:workflowTemplateId"
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
            path="/runtime/test"
            element={<VirtualRuntimeTestPage />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
