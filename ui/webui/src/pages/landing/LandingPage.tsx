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
            Workflow Nexus
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

        {/* Architecture Details */}
        <section className="mt-4 rounded-xl border border-border bg-card p-6">
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

        {/* Schema-Driven UI Example */}
        <section className="mt-4 rounded-xl border border-border bg-card p-6">
          <h2 className="font-landing-display text-xl font-semibold">
            Schema-Driven UI Flow
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Server defines UI layouts via JSON Schema — clients render dynamically without code changes.
          </p>
          
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {/* Module Config */}
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                1. Module Config
              </p>
              <pre className="code-block flex-1 overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed">
{`{
  "module": "user.select",
  "inputs": {
    "prompt": "Choose pet type",
    "data": [
      {
        "id": "cat",
        "label": "Cat",
        "description": "Feline..."
      },
      {
        "id": "dog",
        "label": "Dog",
        "description": "Canine..."
      }
    ],
    "schema": { "$ref": "..." },
    "multi_select": false
  },
  "outputs_to_state": {
    "selected_data": "pet_type"
  }
}`}
              </pre>
            </div>

            {/* Display Schema */}
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                2. Display Schema
              </p>
              <pre className="code-block flex-1 overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed">
{`{
  "type": "array",
  "_ux.render_as": "card-stack",
  "items": {
    "type": "object",
    "_ux": {
      "render_as": "card",
      "selectable": true
    },
    "properties": {
      "label": {
        "type": "string",
        "_ux.render_as": "card-title"
      },
      "description": {
        "type": "string",
        "_ux.render_as": "card-subtitle"
      }
    }
  }
}`}
              </pre>
            </div>

            {/* UI Response */}
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                3. Client Response
              </p>
              <pre className="code-block flex-1 overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed">
{`// Request (Server → UI)
{
  "type": "STRUCTURED_SELECT",
  "payload": {
    "data": [...],
    "schema": {...},
    "multi_select": false
  }
}

// Response (UI → Server)
{
  "workflow_run_id": "abc123",
  "response": {
    "selected_indices": [0],
    "selected_data": [
      { "id": "cat", ... }
    ]
  }
}`}
              </pre>
            </div>
          </div>

          {/* Rendered UI Screenshot */}
          <div className="mt-5 space-y-2">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Rendered UI Result
            </p>
            <div className="overflow-hidden rounded-lg border border-border">
              <img 
                src="/screenshot-simple-module-dark.png" 
                alt="Schema-driven UI rendered as selectable cards"
                className="hidden w-full dark:block"
              />
              <img 
                src="/screenshot-simple-module-light.png" 
                alt="Schema-driven UI rendered as selectable cards"
                className="block w-full dark:hidden"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              The <code className="rounded bg-muted px-1 py-0.5">_ux.*</code> hints control rendering: 
              card layouts, grids, titles, highlights, and custom formatters — all without frontend changes.
            </p>
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
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            <span>Read more:</span>
            <a 
              href="https://github.com/SachiraChin/workflowmanager-showcase" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-2 hover:text-muted-foreground"
            >
              github.com/SachiraChin/workflowmanager-showcase
            </a>
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-10 flex flex-col gap-4 border-t border-border pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Workflow Nexus — Event-sourced workflow execution for AI content generation.
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
