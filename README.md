<p align="center">
  <img src="./bidwright-social.png" alt="Bidwright AI-driven construction estimating platform" width="100%" />
</p>

<h1 align="center">Bidwright</h1>

<p align="center">
  <strong>Construction estimating software that connects intake, knowledge, takeoff, pricing, scheduling, and quote delivery in one AI-native workspace.</strong>
</p>

<p align="center">
  Upload the bid package. Search the spec. Mark up the drawing. Build the estimate. Generate the branded PDF. Send the quote.
</p>

> Bidwright is under active development. This README is intentionally written around capabilities already present in the repo today, while the most ambitious autonomous agent flows are still evolving.

## Why Bidwright

Estimating deserves better than PDF gymnastics, spreadsheet archaeology, and AI chats with no context.

Bidwright brings the full workflow into one system so teams can move from raw bid package to client-ready quote without bouncing between disconnected tools. It combines document intake, searchable knowledge, drawing takeoff, pricing systems, scheduling, quote packaging, and tool-backed AI in a single platform.

## What Bidwright Can Do Today

| Area | Live capabilities in this repo |
| --- | --- |
| Package intake | Upload bid packages, unzip archives, classify files, extract text from PDFs, spreadsheets, and text-based files, and preserve structured tables and key-value data for downstream use. |
| Knowledge and datasets | Upload estimating books, manage global or project-scoped knowledge, chunk and index content, run hybrid search, browse book pages, and build structured datasets manually or from source books. |
| Estimating workspace | Manage projects, quotes, revisions, worksheets, line items, phases, modifiers, conditions, summary rows, notes, lead letters, report sections, activity history, and cross-project performance views. |
| Takeoff and drawing review | Open drawing PDFs, calibrate scale, create count, linear, and area annotations, export markups, run symbol detection, count across pages, and use "Ask AI" on selected regions. |
| Scheduling | Build project schedules with tasks, milestones, dependencies, progress tracking, and Gantt-style views tied back to estimate phases and revisions. |
| Pricing systems | Maintain catalogs, tiered rate schedules, labour cost tables, burden periods, travel policies, entity categories, customers, departments, and reusable condition libraries. |
| Quote output | Compare revisions, preview quote packages, generate branded PDFs with configurable layouts and sections, and send quotes by email. |
| AI and extensibility | Rewrite descriptions and notes, suggest phases and equipment, run tool-backed agent sessions, create plugins, manage dynamic tools, and expose estimating tools through an MCP server. |
| Multi-tenant operations | Support organizations, users, super-admin setup, org switching, brand profiles and brand capture, estimator personas, data import/export, and admin-level management flows. |

## What Makes It Different

- Bidwright does not stop at chat. The AI layer has access to the estimating workspace, knowledge, schedules, rate schedules, datasets, plugins, and project files.
- Drawings, documents, structured knowledge, and estimate math live in the same system instead of being split across five separate tools.
- The platform is designed for real estimator operations, including travel policy logic, burden periods, branded quote output, customer management, and trade-specific personas.
- Extensibility is built in from the start through plugins, dynamic tool definitions, MCP support, and optional Claude Code or Codex runtime sessions.

## AI, Agents, And Automation

Bidwright already includes a serious AI foundation, not just a prompt box.

- Multi-provider model support in the agent layer, including Anthropic, OpenAI, OpenRouter, Gemini, and LM Studio.
- Local embedding support through Ollama, plus `pgvector`-backed retrieval for knowledge search.
- Tool registries for quote operations, knowledge workflows, project files, datasets, schedules, pricing, rate schedules, web-assisted tasks, and plugin management.
- A worker runtime for ingestion, summarization, phase drafting, worksheet drafting, equipment inference, and quote QA scaffolding.
- An MCP server package so Bidwright tools can be used from external coding and agent runtimes.
- CLI runtime support for launching Claude Code or Codex sessions against a project workspace with project context, documents, and knowledge symlinked in.

## Inside The Monorepo

```text
apps/
  api/      Fastify API, auth, quote logic, PDF/email services, AI routes, vision routes
  web/      Next.js app for intake, estimating, takeoff, knowledge, performance, settings
  worker/   BullMQ-oriented orchestration for ingestion and reviewable AI workflows

packages/
  agent/       Tool-backed agent runtime and provider adapters
  ai/          Prompt contracts and typed AI helpers
  db/          Prisma schema, seeders, templates, and database utilities
  domain/      Shared business models and quote logic
  ingestion/   Package extraction, document classification, chunking, and parsing
  mcp-server/  MCP bridge for Bidwright tools
  vector/      Embeddings and pgvector search
  vision/      PDF rendering plus Python/OpenCV-assisted drawing analysis
```

## Run It Locally

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

`pnpm dev` does more than start the apps. It brings up Postgres, Redis, and Ollama in Docker, generates Prisma client code, pushes the schema, sets up `pgvector`, and launches the web app, API, and worker together.

On Windows, the native launcher is also exposed as:

```powershell
pnpm dev:windows
```

After startup:

- Web: `http://localhost:3000`
- API: `http://localhost:4001`
- If no super admin exists yet, Bidwright will open the first-run setup wizard.
- From setup, you can create your organization and optionally load sample data.

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
pnpm docker:up
pnpm docker:down
```

### Script layout

- `scripts/dev/` contains local hot-reload launchers.
- `scripts/db/` contains database bootstrap and seed helpers.
- `scripts/launch/` contains one-click Docker launchers.
- `scripts/ad-hoc/` contains one-off maintenance and extraction scripts.

### Docker-style run

For a fuller containerized run:

```bash
pnpm docker:up
```

You can also use the launch wrappers:

- macOS: `./scripts/launch/start-docker.command`
- Windows: `.\scripts\launch\start-docker.bat`

For an Ubuntu deployment and data migration checklist, see [docs/deployment/ubuntu-docker.md](./docs/deployment/ubuntu-docker.md).

## Core Environment Variables

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

For Docker or server deployments, set `NEXT_PUBLIC_API_BASE_URL` to the public API URL that a browser can reach. `http://localhost:3001` only works for local single-machine runs.

## Tech Stack

- Frontend: Next.js 16, React 19, Tailwind CSS, Radix UI
- API: Fastify 5
- Worker orchestration: BullMQ
- Database: PostgreSQL, Prisma, `pgvector`
- AI: Anthropic, OpenAI, OpenRouter, Gemini, LM Studio, Ollama embeddings
- Vision: Playwright, Python, OpenCV-style symbol analysis pipeline
- Monorepo: pnpm workspaces + Turborepo
- Language: TypeScript with Zod validation

## Status

Bidwright already contains a broad working platform for AI-assisted construction estimating. Core estimating, takeoff, knowledge, pricing, scheduling, branding, admin, and plugin workflows are present in the codebase today. The platform is still moving fast, especially around deeper agent autonomy and advanced automation.

## License

[MIT](LICENSE)
