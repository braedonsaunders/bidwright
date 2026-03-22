#!/usr/bin/env bash
set -euo pipefail

# ── Bidwright Dev Launcher ─────────────────────────────────────────────
# One command: starts Postgres + Redis, runs migrations, launches all services.
# Ctrl-C cleanly stops everything (app processes + Docker containers).
# Usage: pnpm dev

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

export DATABASE_URL="${DATABASE_URL:-postgresql://bidwright:bidwright@localhost:5432/bidwright}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export DATA_DIR="${DATA_DIR:-$ROOT_DIR/data/bidwright-api}"

# ── 0. Cleanup function ───────────────────────────────────────────────

APP_PID=""

cleanup() {
  echo ""
  echo "▸ Shutting down..."

  # Kill the pnpm dev process group
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
    kill -- -"$APP_PID" 2>/dev/null || kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi

  # Kill any remaining tsx/node processes on our ports
  lsof -ti :4001 2>/dev/null | xargs kill -9 2>/dev/null || true
  lsof -ti :3000 2>/dev/null | xargs kill -9 2>/dev/null || true
  pkill -f "tsx watch" 2>/dev/null || true

  # Stop Docker containers
  echo "▸ Stopping Docker containers..."
  docker compose stop 2>/dev/null || true

  echo "▸ Stopped."
  exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# ── 1. Kill orphans from previous runs ─────────────────────────────────

lsof -ti :4001 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti :3000 2>/dev/null | xargs kill -9 2>/dev/null || true

# ── 2. Start infrastructure ───────────────────────────────────────────

echo "▸ Starting Postgres + Redis..."
docker compose up -d postgres redis 2>&1 | grep -v "level=warning"

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

# ── 3. Generate Prisma client + push schema ───────────────────────────

echo "▸ Generating Prisma client..."
pnpm db:generate 2>&1 | tail -1

echo "▸ Pushing schema to database..."
pnpm db:push 2>&1 | grep -E "(sync|Generated|Error)" || true

# ── 4. Create pgvector extension + vector_records table ───────────────

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

# ── 5. Seed database if empty ──────────────────────────────────────────

ORG_COUNT=$(docker compose exec -T postgres psql -U bidwright -d bidwright -tAc "SELECT count(*) FROM \"Organization\";" 2>/dev/null | tr -d ' ' || echo "0")
if [ "$ORG_COUNT" = "0" ]; then
  echo "▸ Empty database — seeding with demo data..."
  pnpm seed 2>&1 | grep -E "^\[seed\]" || echo "  (seed failed — continuing)"
else
  echo "▸ Database has data ($ORG_COUNT org(s)), skipping seed."
fi

# ── 6. Launch all services ────────────────────────────────────────────

echo ""
echo "▸ Bidwright running:"
echo "  API:    http://localhost:4001"
echo "  Web:    http://localhost:3000"
echo "  Worker: background"
echo ""
echo "  Press Ctrl-C to stop everything."
echo ""

# Run in a process group so we can kill all children on exit
set -m
DATABASE_URL="$DATABASE_URL" REDIS_URL="$REDIS_URL" DATA_DIR="$DATA_DIR" \
  pnpm --parallel --filter @bidwright/web --filter @bidwright/api --filter @bidwright/worker dev &
APP_PID=$!

# Wait for the app process — if it exits or we get a signal, cleanup runs
wait "$APP_PID" 2>/dev/null || true
