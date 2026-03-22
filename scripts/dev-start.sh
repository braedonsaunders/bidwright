#!/usr/bin/env bash
set -euo pipefail

# ── Bidwright Dev Launcher ─────────────────────────────────────────────
# One command: starts Postgres + Redis, runs migrations, launches all services.
# Usage: pnpm dev:full  (or: bash scripts/dev-start.sh)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

export DATABASE_URL="${DATABASE_URL:-postgresql://bidwright:bidwright@localhost:5433/bidwright}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export DATA_DIR="${DATA_DIR:-$ROOT_DIR/data/bidwright-api}"

# ── 1. Start infrastructure ───────────────────────────────────────────

echo "▸ Starting Postgres + Redis..."
docker compose up -d postgres redis

# Wait for Postgres to be ready
echo -n "▸ Waiting for Postgres"
until docker compose exec -T postgres pg_isready -U bidwright -d bidwright >/dev/null 2>&1; do
  echo -n "."
  sleep 1
done
echo " ready!"

# Wait for Redis to be ready
echo -n "▸ Waiting for Redis"
until docker compose exec -T redis redis-cli ping >/dev/null 2>&1; do
  echo -n "."
  sleep 1
done
echo " ready!"

# ── 2. Generate Prisma client + push schema ───────────────────────────

echo "▸ Generating Prisma client..."
pnpm db:generate

echo "▸ Pushing schema to database..."
DATABASE_URL="$DATABASE_URL" pnpm db:push 2>/dev/null || {
  echo "▸ db:push not configured, trying prisma db push directly..."
  DATABASE_URL="$DATABASE_URL" npx prisma db push --schema packages/db/prisma/schema.prisma
}

# ── 3. Create pgvector extension + vector_records table ───────────────

echo "▸ Setting up pgvector..."
docker compose exec -T postgres psql -U bidwright -d bidwright -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || true
docker compose exec -T postgres psql -U bidwright -d bidwright <<'SQL' 2>/dev/null || true
CREATE TABLE IF NOT EXISTS vector_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  project_id TEXT,
  scope TEXT NOT NULL DEFAULT 'project',
  embedding vector(1536) NOT NULL,
  text TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vector_records_hnsw ON vector_records USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_vector_records_org ON vector_records (organization_id);
CREATE INDEX IF NOT EXISTS idx_vector_records_project ON vector_records (project_id);
SQL

# ── 4. Migrate existing data if state.json exists ─────────────────────

STATE_FILE="$ROOT_DIR/data/bidwright-api/state.json"
if [ -f "$STATE_FILE" ]; then
  # Check if data already migrated (any org exists)
  ORG_COUNT=$(docker compose exec -T postgres psql -U bidwright -d bidwright -tAc "SELECT count(*) FROM \"Organization\";" 2>/dev/null || echo "0")
  if [ "$ORG_COUNT" = "0" ]; then
    echo "▸ Found state.json — migrating existing data to Postgres..."
    DATABASE_URL="$DATABASE_URL" pnpm migrate:data || echo "  (migration skipped or failed — continuing)"
  else
    echo "▸ Data already migrated (found $ORG_COUNT org(s)), skipping."
  fi
fi

# ── 5. Launch all services ────────────────────────────────────────────

echo ""
echo "▸ Starting Bidwright services..."
echo "  API:    http://localhost:4001"
echo "  Web:    http://localhost:3000"
echo "  Worker: background"
echo ""

DATABASE_URL="$DATABASE_URL" REDIS_URL="$REDIS_URL" DATA_DIR="$DATA_DIR" \
  pnpm --parallel --filter @bidwright/web --filter @bidwright/api --filter @bidwright/worker dev
