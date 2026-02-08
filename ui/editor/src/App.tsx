export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-7xl p-6">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">Workflow Editor</h1>
          <p className="text-sm text-muted-foreground">
            Editor workspace scaffold is ready.
          </p>
        </header>
        <section className="grid gap-4 md:grid-cols-[260px_1fr_320px]">
          <aside className="rounded-lg border bg-card p-4">Module Palette</aside>
          <div className="min-h-[420px] rounded-lg border bg-card p-4">
            Canvas
          </div>
          <aside className="rounded-lg border bg-card p-4">Properties</aside>
        </section>
      </main>
    </div>
  );
}
