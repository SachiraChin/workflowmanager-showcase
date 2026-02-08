import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ReactFlowStressPocPage } from "@/poc/reactflow/StressPocPage";
import { ReactFlowUserInputPocPage } from "@/poc/reactflow/UserInputPocPage";

function HomePage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-7xl p-6">
        <header className="mb-6 space-y-2">
          <h1 className="text-2xl font-semibold">Workflow Editor PoCs</h1>
          <p className="text-sm text-muted-foreground">
            React Flow is the first candidate. Use these pages to evaluate
            nested performance and real workflow UX.
          </p>
        </header>
        <section className="grid gap-4 md:grid-cols-2">
          <a
            className="rounded-lg border bg-card p-5 hover:bg-muted/40"
            href="/poc/reactflow/stress"
          >
            <h2 className="text-lg font-medium">React Flow Stress PoC</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Deep nesting and scale behavior under synthetic load.
            </p>
          </a>
          <a
            className="rounded-lg border bg-card p-5 hover:bg-muted/40"
            href="/poc/reactflow/user-input"
          >
            <h2 className="text-lg font-medium">React Flow User Input PoC</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Two-module rendering based on `workflows/cc/steps/1_user_input`.
            </p>
          </a>
        </section>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/poc/reactflow/stress" element={<ReactFlowStressPocPage />} />
        <Route
          path="/poc/reactflow/user-input"
          element={<ReactFlowUserInputPocPage />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
