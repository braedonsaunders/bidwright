#!/usr/bin/env bash
set -euo pipefail

# Bidwright dev launcher.
# Starts Postgres, Redis, and Ollama in Docker, prepares the database,
# and then runs the web app, API, and worker with hot reload.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

export DATABASE_URL="${DATABASE_URL:-postgresql://bidwright:bidwright@localhost:5432/bidwright}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export DATA_DIR="${DATA_DIR:-$ROOT_DIR/data/bidwright-api}"
export DEFAULT_ORG_ID="${DEFAULT_ORG_ID:-org-bidwright-seed}"
export API_PORT="${API_PORT:-4001}"
export NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-http://localhost:4001}"

APP_PID=""

cleanup() {
  echo ""
  echo "[*] Shutting down..."

  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
    kill -- -"$APP_PID" 2>/dev/null || kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi

  lsof -ti :4001 2>/dev/null | xargs kill -9 2>/dev/null || true
  lsof -ti :3000 2>/dev/null | xargs kill -9 2>/dev/null || true
  pkill -f "tsx watch" 2>/dev/null || true

  echo "[*] Stopping Docker containers..."
  docker compose stop 2>/dev/null || true

  echo "[*] Stopped."
  exit 0
}

trap cleanup SIGINT SIGTERM EXIT

lsof -ti :4001 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti :3000 2>/dev/null | xargs kill -9 2>/dev/null || true

echo "[*] Starting Postgres + Redis + Ollama..."
docker compose up -d postgres redis ollama 2>&1 | grep -v "level=warning"

echo -n "[*] Waiting for Postgres"
until docker compose exec -T postgres pg_isready -U bidwright -d bidwright >/dev/null 2>&1; do
  echo -n "."
  sleep 1
done
echo " ready!"

echo -n "[*] Waiting for Redis"
until docker compose exec -T redis redis-cli ping >/dev/null 2>&1; do
  echo -n "."
  sleep 1
done
echo " ready!"

# Available models (set EMBEDDING_MODEL to switch):
#   snowflake-arctic-embed   - 1024 dims, 335MB (default, best quality)
#   nomic-embed-text         - 768 dims, 274MB (good balance)
#   mxbai-embed-large        - 1024 dims, 670MB (largest, highest quality)
export EMBEDDING_PROVIDER="${EMBEDDING_PROVIDER:-local}"
export EMBEDDING_BASE_URL="${EMBEDDING_BASE_URL:-http://localhost:11434/v1}"
export EMBEDDING_MODEL="${EMBEDDING_MODEL:-snowflake-arctic-embed}"

case "$EMBEDDING_MODEL" in
  nomic-embed-text)       export EMBEDDING_DIMENSIONS="${EMBEDDING_DIMENSIONS:-768}" ;;
  mxbai-embed-large)      export EMBEDDING_DIMENSIONS="${EMBEDDING_DIMENSIONS:-1024}" ;;
  snowflake-arctic-embed) export EMBEDDING_DIMENSIONS="${EMBEDDING_DIMENSIONS:-1024}" ;;
  *)                      export EMBEDDING_DIMENSIONS="${EMBEDDING_DIMENSIONS:-1024}" ;;
esac

echo -n "[*] Waiting for Ollama"
for i in $(seq 1 30); do
  if curl -sf http://localhost:11434/ >/dev/null 2>&1; then
    echo " ready!"
    break
  fi
  echo -n "."
  sleep 1
  if [ "$i" -eq 30 ]; then
    echo " timeout (will continue without embeddings)"
  fi
done

if curl -sf http://localhost:11434/ >/dev/null 2>&1; then
  if ! docker compose exec -T ollama ollama list 2>/dev/null | grep -q "$EMBEDDING_MODEL"; then
    echo "[*] Pulling embedding model: $EMBEDDING_MODEL (first run only)..."
    docker compose exec -T ollama ollama pull "$EMBEDDING_MODEL" 2>&1 | tail -1
  else
    echo "[*] Embedding model: $EMBEDDING_MODEL (cached)"
  fi
fi

echo "[*] Generating Prisma client..."
pnpm db:generate >/dev/null 2>&1

echo "[*] Pushing schema to database..."
yes | pnpm db:push -- --accept-data-loss --skip-generate >/dev/null 2>&1 || true

EMBED_DIM="${EMBEDDING_DIMENSIONS:-768}"
echo "[*] Setting up pgvector (${EMBED_DIM} dimensions)..."
docker compose exec -T postgres psql -U bidwright -d bidwright -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || true

CURRENT_DIM=$(docker compose exec -T postgres psql -U bidwright -d bidwright -tAc "
  SELECT atttypmod FROM pg_attribute
  WHERE attrelid = 'vector_records'::regclass AND attname = 'embedding';
" 2>/dev/null | tr -d ' ' || echo "0")
if [ "$CURRENT_DIM" != "0" ] && [ "$CURRENT_DIM" != "$EMBED_DIM" ]; then
  echo "  Dimension mismatch ($CURRENT_DIM -> $EMBED_DIM), recreating vector_records..."
  docker compose exec -T postgres psql -U bidwright -d bidwright -c "DROP TABLE IF EXISTS vector_records;" 2>/dev/null || true
fi

docker compose exec -T postgres psql -U bidwright -d bidwright <<SQL 2>/dev/null || true
CREATE TABLE IF NOT EXISTS vector_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  project_id TEXT,
  scope TEXT NOT NULL DEFAULT 'project',
  embedding vector($EMBED_DIM) NOT NULL,
  text TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vector_records_hnsw ON vector_records USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_vector_records_org ON vector_records (organization_id);
CREATE INDEX IF NOT EXISTS idx_vector_records_project ON vector_records (project_id);
SQL

ADMIN_COUNT=$(docker compose exec -T postgres psql -U bidwright -d bidwright -tAc "SELECT count(*) FROM \"SuperAdmin\";" 2>/dev/null | tr -d ' ' || echo "0")
ORG_COUNT=$(docker compose exec -T postgres psql -U bidwright -d bidwright -tAc "SELECT count(*) FROM \"Organization\";" 2>/dev/null | tr -d ' ' || echo "0")
if [ "$ADMIN_COUNT" = "0" ]; then
  echo "[*] No admin account. The setup wizard will run on first visit."
elif [ "$ORG_COUNT" = "0" ]; then
  echo "[*] Empty database. Seeding with demo data..."
  pnpm seed 2>&1 | grep -E "^\[seed\]" || echo "  (seed failed; continuing)"
else
  echo "[*] Database has data ($ORG_COUNT org(s)); skipping seed."
fi

echo ""
echo "[*] Bidwright running:"
echo "  API:    http://localhost:4001"
echo "  Web:    http://localhost:3000"
echo "  Worker: background"
echo ""
echo "  Press Ctrl-C to stop everything."
echo ""

set -m
DATABASE_URL="$DATABASE_URL" REDIS_URL="$REDIS_URL" DATA_DIR="$DATA_DIR" \
  BIDWRIGHT_SKIP_BOOTSTRAP_MIGRATIONS=1 \
  pnpm --parallel --filter @bidwright/web --filter @bidwright/api --filter @bidwright/worker dev &
APP_PID=$!

wait "$APP_PID" 2>/dev/null || true
