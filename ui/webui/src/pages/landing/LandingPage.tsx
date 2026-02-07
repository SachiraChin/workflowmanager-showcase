import { Link } from "react-router-dom";
import { LandingHeader } from "./LandingHeader";
import { ArchitectureDiagram } from "./ArchitectureDiagram";

/**
 * Landing Page
 * 
 * Layout: Full-width with contained card sections
 * Philosophy: Each section is a distinct card with visual separation
 * Visual: Cards on muted background, no high-contrast inversions
 */
export function LandingPage() {
  return (
    <div className="min-h-screen bg-muted text-foreground">
      <LandingHeader />

      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* Hero Card */}
        <section className="rounded-xl border border-border bg-card p-8 sm:p-10">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            AI-Powered Content Generation Platform
          </p>
          <h1 className="mt-4 max-w-2xl font-landing-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Workflow Manager
          </h1>
          <p className="mt-4 max-w-xl text-muted-foreground">
            A modular, event-sourced workflow execution platform for orchestrating
            multi-step AI content generation pipelines. Combine LLM calls, user
            interactions, and media generation through declarative JSON configuration.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/workflows"
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Open App
            </Link>
            <a
              href="#architecture"
              className="rounded-md border border-border px-5 py-2.5 text-sm font-medium hover:bg-accent"
            >
              Learn more
            </a>
          </div>
          <div className="mt-8 grid gap-4 border-t border-border pt-6 sm:grid-cols-3">
            {[
              { label: "Event Sourcing", desc: "Immutable state with replay and audit" },
              { label: "SSE Streaming", desc: "Real-time bidirectional updates" },
              { label: "Schema-Driven UI", desc: "Dynamic rendering from JSON Schema" },
            ].map((item) => (
              <div key={item.label}>
                <p className="font-landing-display text-sm font-semibold">
                  {item.label}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Architecture Diagram */}
        <section id="architecture" className="mt-4">
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-landing-display text-lg font-semibold">
              System Architecture
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Layered architecture with event-sourced state management. Hover nodes for details.
            </p>
            <div className="mt-3">
              <ArchitectureDiagram />
            </div>
          </div>
        </section>

        {/* Architecture Details + Execution Flow */}
        <section className="mt-4 grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-landing-display text-xl font-semibold">
              Architecture & Backend
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">Python / FastAPI</p>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li>
                Event-sourced state management with MongoDB — all state changes
                persisted as immutable events for replay, recovery, and audit trails.
              </li>
              <li>
                Jinja2-based template resolution for dynamic step configuration
                with full workflow state access during runtime.
              </li>
              <li>
                Server-Sent Events (SSE) for real-time bidirectional communication
                between server and clients during execution.
              </li>
              <li>
                Actor-based background worker with MongoDB-backed task queue,
                per-actor concurrency limits, heartbeat monitoring, and stale task recovery.
              </li>
            </ul>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Execution Flow
            </p>
            <div className="mt-4 space-y-2 text-sm">
              {[
                "Resolve templates",
                "Execute module",
                "Stream events",
                "Capture feedback",
                "Persist state",
              ].map((step, i) => (
                <div key={step} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Frontend Card */}
        <section className="mt-4 rounded-xl border border-border bg-card p-6">
          <h2 className="font-landing-display text-xl font-semibold">
            Frontend
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">React / TypeScript</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li>
                Schema-driven UI rendering — server defines interaction layouts
                via JSON Schema, enabling dynamic forms and grids without code changes.
              </li>
              <li>
                Shared component library (@wfm/shared) with Radix UI primitives,
                shadcn/ui styling, and Zustand state management.
              </li>
            </ul>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li>
                Monaco editor for code/prompt editing, WaveSurfer.js for audio
                waveform visualization, image cropping components.
              </li>
              <li>
                Alternative terminal UI (Textual/Rich) supporting the same
                interaction protocol for headless environments.
              </li>
            </ul>
          </div>
        </section>

        {/* AI Providers + Modules */}
        <section className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-landing-display text-base font-semibold">
              AI Provider Integrations
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Unified interface abstracting differences between providers.
              Structured output via JSON Schema with automatic sanitization.
            </p>
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              <li>OpenAI (GPT-4o, o1, o3) with prompt caching</li>
              <li>Anthropic Claude</li>
              <li>Leonardo.ai, MidJourney API</li>
              <li>ElevenLabs text-to-speech</li>
              <li>Local Stable Diffusion via SD WebUI Forge</li>
            </ul>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-landing-display text-base font-semibold">
              Module System
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Pluggable components — add capabilities without modifying core engine.
            </p>
            <div className="mt-3 space-y-2">
              {[
                { cat: "API", mods: "api.llm, api.fetch" },
                { cat: "User", mods: "user.select, user.form, user.pause" },
                { cat: "Transform", mods: "reshape, query, enrich" },
                { cat: "Media", mods: "media.generate" },
                { cat: "IO", mods: "save_json, write_text, load_json" },
              ].map((item) => (
                <div key={item.cat} className="flex items-center gap-2 text-sm">
                  <span className="font-medium w-20">{item.cat}</span>
                  <span className="text-muted-foreground">{item.mods}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Data Layer Card */}
        <section className="mt-4 rounded-xl border border-border bg-card p-6">
          <h2 className="font-landing-display text-xl font-semibold">
            Data Layer & Infrastructure
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                MongoDB with repository pattern — separate repositories for
                workflows, events, content, users, and media references.
              </li>
              <li>
                Dual storage model: JSON/text content in MongoDB, generated
                media on filesystem with database references.
              </li>
            </ul>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                Migration system with versioned scripts for schema evolution.
              </li>
              <li>
                Docker Compose deployment with Nginx reverse proxy and
                automated backup scripts.
              </li>
            </ul>
          </div>
        </section>

        {/* Technical Stack Card */}
        <section className="mt-4 rounded-xl border border-border bg-card p-6">
          <h2 className="font-landing-display text-xl font-semibold">
            Technical Stack
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              "Python 3.10+",
              "FastAPI",
              "Pydantic",
              "MongoDB",
              "React 19",
              "TypeScript",
              "Vite",
              "TailwindCSS 4",
              "Radix UI",
              "Zustand",
              "Textual",
              "Docker",
            ].map((tech) => (
              <span
                key={tech}
                className="rounded-md border border-border px-2.5 py-1 text-sm"
              >
                {tech}
              </span>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-10 flex flex-col gap-4 border-t border-border pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Workflow Manager — Event-sourced workflow execution for AI content generation.
          </p>
          <Link
            to="/workflows"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Open App
          </Link>
        </footer>
      </main>
    </div>
  );
}
