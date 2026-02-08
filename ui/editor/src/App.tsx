import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import { useState } from "react";
import { ReactFlowStressPocPage } from "@/poc/reactflow/StressPocPage";
import { ReactFlowUserInputPocPage } from "@/poc/reactflow/UserInputPocPage";
import { UserSelectVirtualRuntimePage } from "@/runtime/UserSelectVirtualRuntimePage";

function HomePage() {
  return (
    <main className="mx-auto max-w-7xl p-6">
      <header className="mb-6 space-y-2">
        <h1 className="text-2xl font-semibold">Workflow Editor PoCs</h1>
        <p className="text-sm text-muted-foreground">
          Compare candidate libraries with matching stress and workflow-realism
          PoCs from the header menu.
        </p>
      </header>
      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-lg border bg-card p-5">
          <h2 className="text-lg font-medium">React Flow</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Baseline candidate with nested group and step-structure PoCs.
          </p>
        </article>
        <article className="rounded-lg border bg-card p-5">
          <h2 className="text-lg font-medium">Runtime (Virtual API)</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Real InteractionHost payloads via virtual module execution endpoints.
          </p>
        </article>
      </section>
    </main>
  );
}

function HeaderNav() {
  const [openMenu, setOpenMenu] = useState<"reactflow" | "runtime" | null>(
    null
  );

  const closeMenus = () => setOpenMenu(null);

  const toggleMenu = (menu: "reactflow" | "runtime") => {
    setOpenMenu((current) => (current === menu ? null : menu));
  };

  return (
    <header className="relative z-50 border-b bg-card">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link className="text-sm font-semibold" to="/">
          Workflow Editor
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <div className="relative">
            <button
              className="cursor-pointer rounded-md border bg-card px-3 py-1.5 hover:bg-muted/40"
              onClick={() => toggleMenu("reactflow")}
              type="button"
            >
              React Flow
            </button>
            {openMenu === "reactflow" ? (
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
                  to="/poc/reactflow/user-input"
                >
                  User Input PoC
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
                  className="block rounded px-3 py-2 hover:bg-muted"
                  onClick={closeMenus}
                  to="/runtime/user-select"
                >
                  user.select (first 2 modules)
                </Link>
              </div>
            ) : null}
          </div>
        </nav>
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
          <Route path="/" element={<HomePage />} />
          <Route
            path="/poc/reactflow/stress"
            element={<ReactFlowStressPocPage />}
          />
          <Route
            path="/poc/reactflow/user-input"
            element={<ReactFlowUserInputPocPage />}
          />
          <Route
            path="/runtime/user-select"
            element={<UserSelectVirtualRuntimePage />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
