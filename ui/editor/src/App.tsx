import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import { ReactFlowStressPocPage } from "@/poc/reactflow/StressPocPage";
import { ReactFlowUserInputPocPage } from "@/poc/reactflow/UserInputPocPage";
import { X6StressPocPage } from "@/poc/x6/StressPocPage";
import { X6UserInputPocPage } from "@/poc/x6/UserInputPocPage";

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
          <h2 className="text-lg font-medium">X6 (Community / MIT)</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Second candidate using community edition components only.
          </p>
        </article>
      </section>
    </main>
  );
}

function HeaderNav() {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link className="text-sm font-semibold" to="/">
          Workflow Editor
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <details className="group relative">
            <summary className="cursor-pointer list-none rounded-md border px-3 py-1.5 hover:bg-muted/40">
              React Flow
            </summary>
            <div className="absolute right-0 z-10 mt-2 w-56 rounded-md border bg-popover p-1 shadow-md">
              <Link
                className="block rounded px-3 py-2 hover:bg-muted"
                to="/poc/reactflow/stress"
              >
                Stress PoC
              </Link>
              <Link
                className="block rounded px-3 py-2 hover:bg-muted"
                to="/poc/reactflow/user-input"
              >
                User Input PoC
              </Link>
            </div>
          </details>
          <details className="group relative">
            <summary className="cursor-pointer list-none rounded-md border px-3 py-1.5 hover:bg-muted/40">
              X6
            </summary>
            <div className="absolute right-0 z-10 mt-2 w-56 rounded-md border bg-popover p-1 shadow-md">
              <Link className="block rounded px-3 py-2 hover:bg-muted" to="/poc/x6/stress">
                Stress PoC
              </Link>
              <Link
                className="block rounded px-3 py-2 hover:bg-muted"
                to="/poc/x6/user-input"
              >
                User Input PoC
              </Link>
            </div>
          </details>
        </nav>
      </div>
    </header>
  );
}

function AppShell() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <HeaderNav />
      <Outlet />
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
          <Route path="/poc/x6/stress" element={<X6StressPocPage />} />
          <Route path="/poc/x6/user-input" element={<X6UserInputPocPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
