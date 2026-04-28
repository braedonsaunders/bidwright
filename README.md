<p align="center">
  <img src="./bidwright-social.png" alt="Bidwright AI-driven construction estimating platform" width="100%" />
</p>

<h1 align="center">Bidwright</h1>

<p align="center">
  <strong>The estimating platform that runs the whole bid — intake, knowledge, takeoff, pricing, scheduling, review, and quote delivery — on top of an AI agent that actually has hands.</strong>
</p>

<p align="center">
  Drop the bid package. Index the spec. Take off the drawings <em>and</em> the model. Parameterize the assemblies. Price it with real burdens. Let the agent review it. Send the branded quote.
</p>

> Bidwright is under active development. This README is written around capabilities already present in the repo today. Where something is foundational rather than fully shipped, it's called out.

<p align="center">
  <a href="https://github.com/braedonsaunders/codeflow"><img src=".github/codeflow-card.svg" alt="Bidwright codebase stats — powered by codeflow" width="100%" /></a>
</p>

## Why estimators care

Estimating today is duct tape: a PDF viewer, a takeoff app, a spreadsheet from 2014, a pricing book in someone's drawer, a schedule in a separate tool, and a chatbot that doesn't know what project you're on.

Bidwright collapses that stack. One workspace. One database. One AI agent with **150+ tools** wired into your live project — quotes, knowledge, drawings, models, pricing, schedules, plugins. No copy-paste. No "let me describe my project to the AI again."

## The headline features

### 1. An agent with 150+ real tools — not a chat box bolted on

The agent layer ships with **150 typed tools across 13 modules** (`packages/agent/src/tools/`): quote construction, estimate strategy, knowledge retrieval, project files, datasets, pricing, rate schedules, scheduling, web research, plugin execution, and dynamic tool registration. It can read a worksheet, propose phases, edit line items, pull a chunk from a knowledge book, query a rate schedule, and write a note — in one session, with audit trail.

Multi-provider out of the box: **Anthropic, OpenAI, OpenRouter, Gemini, LM Studio**. Local embeddings via **Ollama**. Hybrid retrieval over **pgvector**.

### 2. Bring your own coding agent — Claude Code & Codex runtimes

Bidwright can spawn a **Claude Code** or **Codex** session against an isolated workspace seeded with the project's documents, knowledge, and CLAUDE.md context. Stream responses, read/write memory, monitor sessions, stop them. The same machinery powers the in-app review feature — and it's exposed at `/api/cli/*` for your own automations.

### 3. MCP server — Bidwright tools in your editor

The `packages/mcp-server` package exposes Bidwright's estimate, knowledge, model, quote, review, system, and vision tools over **Model Context Protocol**. Point Claude Code, Cursor, or any MCP-aware client at it and your estimating data is one tool call away from your IDE.

### 4. 2D takeoff *and* 3D model takeoff — linked to the worksheet

- **2D drawings:** open PDFs, calibrate scale, count/linear/area annotations, symbol detection, multi-page counts, "Ask AI" on a selected region, export markups.
- **3D models:** ingest BIM/CAD, parse element hierarchies (parent/child, material, system, discipline), extract per-element quantities with confidence/method tracking, generate filtered BOMs, and **diff revisions** (baseline vs. head).
- **Both link back to worksheet line items** via `TakeoffLink` and `ModelTakeoffLink` — annotations and 3D elements stay tied to the dollars they drive, with quantity multipliers and override fields.

A dedicated **Model Editor** app (`apps/model-editor/`) ships alongside the main web app for heads-down 3D work, with bidirectional sync to the quote workspace.

### 5. Assemblies — reusable kits with parameters and nested sub-assemblies

Define an assembly once, drop it in a hundred quotes. Each assembly supports:

- **Typed parameters** with defaults and units (`AssemblyParameter`)
- **Quantity expressions** that bind to those parameters (`quantityExpr`, `parameterBindings`)
- **Nested sub-assemblies** (`AssemblyComponent.subAssemblyId`)
- **Per-component overrides** for cost, markup, and UOM
- **Snapshotting** so worksheet items remember the source assembly state at the time of insertion

This is the layer most takeoff tools punt on. It's shipped here.

### 6. Estimate strategy — a structured way to think before you price

Bidwright's `EstimateStrategy` walks a quote through **Scope → Execution → Packaging → Benchmark → Reconcile → Complete**, with:

- A **scope graph** of items, constraints, and alternates with confidence levels
- An **execution plan** (self-perform vs. sub, crew strategy, procurement risk)
- A **package plan** splitting work into detailed / allowance / historical / subcontract by phase
- **Benchmark comparables** against prior projects
- **Assumptions** with evidence and explicit user confirmation flags

You're not just bidding — you're keeping receipts.

### 7. Quote review — the agent reads your bid back to you

Hit review and Bidwright spawns an isolated agent session that ingests the project documents and your estimate, then produces:

- **Coverage** findings (YES / VERIFY / NO) tied to spec evidence
- **Gaps**, **risks**, and **cost anomalies**
- A **competitiveness** score
- **Recommendations** with status tracking (resolve, dismiss, defer)
- An **`EstimateCalibrationFeedback`** record that closes the loop on systematic over/under-pricing

You see exactly which document chunk the finding came from. No hand-waving.

### 8. A real pricing engine, not a unit cost column

- **Rate schedules** with tiered multipliers (regular / overtime / double / custom tiers)
- **Labour cost tables** by trade and role
- **Burden periods** with date-ranged percentages
- **Travel policies** with per diem, mileage, fuel surcharge, accommodation, and embed modes
- **Catalogs** for equipment and material lookups
- **Reusable conditions** library

Built for the estimator who knows that "rate × hours" is the easy part.

### 9. Knowledge that the AI actually uses

Three tiers, all org- or project-scoped:

- **Knowledge Books** — ingested PDFs (estimating books, specs, manuals) chunked, embedded, and searchable
- **Knowledge Documents** — hand-authored pages with structure and metadata
- **Datasets** — structured tables built manually or extracted from books

Bind them to **Estimator Personas** — per-trade AI configurations with system prompts, default assumptions, productivity guidance, and review focus areas — so the agent answers like *your* senior estimator, not a generic LLM.

### 10. Plugins and dynamic tools

Drop in a plugin with a config schema and tool definitions, and it shows up in the agent's tool registry and the UI. Every execution is tracked (input, formstate, output, applied line items) so plugins are auditable, not magic.

## What's in the box (verified, today)

| Area | Live capabilities |
| --- | --- |
| Package intake | Upload bid packages, unzip archives, classify files, extract text from PDFs, spreadsheets, and text files, preserve tables and key-value structure. |
| Knowledge | Books, documents, datasets, cabinets (org or project scoped), hybrid pgvector search, persona binding, page browsing. |
| Estimating workspace | Projects, quotes, revisions, worksheets, line items, phases, modifiers, conditions, summary rows, notes, lead letters, report sections, activity history, cross-project performance views. |
| Assemblies | Parameterized kits, nested sub-assemblies, quantity expressions, per-component overrides, worksheet snapshotting. |
| 2D takeoff | PDF viewer, scale calibration, count/linear/area annotations, symbol detection, multi-page counts, region "Ask AI", markup export. |
| 3D model takeoff | Element hierarchy ingestion, per-element quantities, BOM generation, revision diffing, worksheet links with multipliers. |
| Scheduling | Tasks, milestones, SS/SF/FS/FF dependencies, calendars, resources, baselines, Gantt views tied to estimate phases. |
| Pricing | Catalogs, tiered rate schedules, labour cost tables, burden periods, travel policies, entity categories, customers, departments, conditions. |
| Quote output | Revision compare, package preview, branded PDF generation with configurable layouts and sections, email delivery. |
| AI & agents | Multi-provider models, 150+ tools, local Ollama embeddings, MCP server, Claude Code / Codex runtime sessions, plugin framework. |
| Quote review | Agent-driven coverage / gap / risk / competitiveness analysis with evidence-linked findings and calibration feedback. |
| Multi-tenant ops | Organizations, users, super-admin setup, org switching, brand profiles, brand capture from website crawl, estimator personas, data import/export, admin flows. |

**By the numbers:** 73 Prisma models · 150 agent tools across 13 modules · 17 API route files · 21 web pages · 7 MCP tool modules · 6 worker job types.

## What makes it different

- **The agent has the keys.** Every estimate, every drawing, every catalog row, every schedule task is reachable through typed tools — not pasted into a prompt.
- **Drawings, models, knowledge, and dollars share one schema.** A 3D element points to a worksheet line. A symbol count drives a quantity. A spec chunk justifies a finding. No CSV bridges.
- **Built for actual estimating ops** — burdens, travel, branded output, persona-driven AI, customer management. Not a generic SaaS dressed up as a takeoff tool.
- **Local-first AI is a real option.** Run Ollama for embeddings, LM Studio for inference. Your bid data doesn't have to leave the machine.
- **Extensible from day one.** Plugins, dynamic tools, MCP, Claude Code / Codex runtimes. If you can write the tool, Bidwright can run it.

## Inside the monorepo

```text
apps/
  api/            Fastify API — auth, quote logic, PDF/email, AI/vision routes, CLI runtime
  web/            Next.js app — intake, estimating, takeoff, knowledge, performance, settings
  worker/         BullMQ orchestration for ingestion and reviewable AI workflows
  model-editor/   Standalone 3D model editor with bidirectional worksheet sync

packages/
  agent/        Tool-backed agent runtime, provider adapters, 150+ tools
  ai/           Prompt contracts and typed AI helpers
  db/           Prisma schema (73 models), seeders, templates, db utilities
  domain/       Shared business models and quote logic
  ingestion/    Package extraction, classification, chunking, parsing
  mcp-server/   MCP bridge exposing Bidwright tools to external agents
  vector/       Embeddings and pgvector hybrid retrieval
  vision/       PDF rendering, 2D symbol analysis, 3D model parsing
```

## Run it locally

### Prerequisites

- Node.js 20+
- pnpm 10+
- Docker Desktop
- Optional: OpenAI and/or Anthropic API keys for AI features

### Fastest dev path

```bash
pnpm install
cp .env.example .env
pnpm dev
```

`pnpm dev` brings up Postgres, Redis, and Ollama in Docker, generates the Prisma client, pushes the schema, sets up `pgvector`, and launches the web app, API, and worker together.

On Windows:

```powershell
pnpm dev:windows
```

After startup:

- Web: `http://localhost:3000`
- API: `http://localhost:4001`
- If no super admin exists, Bidwright opens the first-run setup wizard. From there, create your org and optionally load sample data.

### Useful commands

```bash
pnpm dev:web
pnpm dev:api
pnpm dev:worker
pnpm build
pnpm typecheck
pnpm lint
pnpm db:generate
pnpm db:push
pnpm db:seed
pnpm deploy:export
pnpm docker:up
pnpm docker:down
```

### Script layout

- `scripts/dev/` — local hot-reload launchers
- `scripts/db/` — database bootstrap and seed helpers
- `scripts/deploy/` — export, restore, server deploy helpers
- `scripts/launch/` — one-click Docker launchers
- `scripts/ad-hoc/` — one-off maintenance and extraction scripts

### Containerized run

```bash
pnpm docker:up
```

Wrappers:

- macOS: `./scripts/launch/start-docker.command`
- Windows: `.\scripts\launch\start-docker.bat`

For Ubuntu deployment and data migration: [docs/deployment/ubuntu-docker.md](./docs/deployment/ubuntu-docker.md).
For the GitHub Actions release/deploy flow: [docs/deployment/github-actions-docker.md](./docs/deployment/github-actions-docker.md).

## Core environment variables

```bash
DATABASE_URL="postgresql://bidwright:bidwright@localhost:5432/bidwright"
REDIS_URL="redis://localhost:6379"
DATA_DIR="./data/bidwright-api"
API_PORT="4001"
NEXT_PUBLIC_API_BASE_URL="http://localhost:4001"
WEB_PUBLIC_PORT="3000"
API_PUBLIC_PORT="3001"

OPENAI_API_KEY=""
OPENAI_MODEL="gpt-5"
OPENAI_EMBEDDING_MODEL="text-embedding-3-large"

ANTHROPIC_API_KEY=""
LLM_PROVIDER="anthropic"
LLM_MODEL="claude-sonnet-4-20250514"

EMBEDDING_PROVIDER="local"
EMBEDDING_BASE_URL="http://localhost:11434/v1"
EMBEDDING_MODEL="snowflake-arctic-embed"
EMBEDDING_DIMENSIONS="1024"

SMTP_HOST=""
SMTP_PORT="587"
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM=""
SMTP_FROM_NAME="Bidwright"
```

For Docker or server deployments, set `NEXT_PUBLIC_API_BASE_URL` to a URL the browser can actually reach. `http://localhost:3001` only works for single-machine local runs.

## Tech stack

- **Frontend:** Next.js 16, React 19, Tailwind CSS, Radix UI
- **API:** Fastify 5
- **Worker orchestration:** BullMQ
- **Database:** PostgreSQL, Prisma, `pgvector`
- **AI:** Anthropic, OpenAI, OpenRouter, Gemini, LM Studio, Ollama embeddings
- **Vision:** Playwright, Python, OpenCV-style 2D symbol pipeline, 3D model parsing
- **Agent runtimes:** Claude Code, Codex, MCP
- **Monorepo:** pnpm workspaces + Turborepo
- **Language:** TypeScript with Zod validation

## Status

Bidwright is a working platform for AI-assisted construction estimating. Core estimating, takeoff (2D and 3D), assemblies, knowledge, pricing, scheduling, review, branding, multi-tenant admin (organizations, users, super-admin setup and org switching), plugins, MCP, and CLI agent workflows are present in the codebase today. Areas like deeper third-party integrations and performance analytics dashboards are still filling in. The platform is moving fast — especially around agent autonomy, calibration feedback, and the model takeoff layer.

## License

[MIT](LICENSE)
