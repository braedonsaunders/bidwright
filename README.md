# Bidwright

AI-first construction estimating platform. Manage project bids, quotes, and estimates with AI-powered analysis and automation.

## Tech Stack

- **Frontend:** Next.js 16, React 19, Tailwind CSS, Radix UI
- **API:** Fastify 5
- **Database:** SQLite (dev) via Prisma ORM
- **AI:** OpenAI, Anthropic SDKs — multi-provider LLM support
- **Monorepo:** pnpm workspaces + Turborepo
- **Language:** TypeScript (strict) with Zod runtime validation

## Project Structure

```
bidwright/
├── apps/
│   ├── api/            # Fastify REST API
│   ├── web/            # Next.js web app
│   └── worker/         # Background job processor
├── packages/
│   ├── agent/          # Agentic AI runtime & tool registry
│   ├── ai/             # LLM integration layer
│   ├── db/             # Prisma schema & migrations
│   ├── domain/         # Core business logic & types
│   ├── ingestion/      # Document processing pipeline
│   ├── vector/         # Vector embeddings & search
│   └── vision/         # Document vision/OCR pipeline
```

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 10+

### Setup

```bash
# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env
# Fill in your API keys in .env

# Generate Prisma client & sync schema
pnpm db:generate
pnpm db:push

# Seed sample data
pnpm db:seed
```

### Environment Variables

```
DATABASE_URL="file:./packages/db/dev.db"
OPENAI_API_KEY=""
OPENAI_MODEL="gpt-5"
OPENAI_EMBEDDING_MODEL="text-embedding-3-large"
API_PORT="4001"
NEXT_PUBLIC_API_BASE_URL="http://localhost:4001"
```

### Development

```bash
# Run all services (web + api + worker)
pnpm dev

# Or individually
pnpm dev:web      # Next.js → localhost:3000
pnpm dev:api      # Fastify API → localhost:4001
pnpm dev:worker   # Background worker
```

### Build & Checks

```bash
pnpm build        # Build all packages
pnpm typecheck    # TypeScript validation
pnpm lint         # Linting
```

## Features

- **Project Management** — Create and track construction projects through bid stages
- **Quote Builder** — Revisions, worksheets, line items with cost/markup/pricing
- **Document Ingestion** — Process ZIP packages of specs, drawings, and RFQs
- **AI Analysis** — Phase drafting, equipment suggestions, quote QA
- **PDF Generation** — Export quotes and reports
- **Agentic AI** — Tool registry with 70+ specialized operations (in progress)
- **Vector Search** — RAG over project documents via embeddings (in progress)

## Database

SQLite in development with Prisma ORM. Key models:

`Project` → `Quote` → `Revision` → `Worksheet` → `WorksheetItem`

Supporting models: `Phase`, `Modifier`, `Condition`, `ReportSection`, `AIRun`, `SourceDocument`

## License

[MIT](LICENSE)
