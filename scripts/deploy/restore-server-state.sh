#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <db-dump-path> <data-archive-path>" >&2
  exit 1
fi

DB_DUMP_PATH="$(realpath "$1")"
DATA_ARCHIVE_PATH="$(realpath "$2")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DEPLOY_BASE="${DEPLOY_BASE:-/opt/bidwright}"
ENV_FILE="${ENV_FILE:-${DEPLOY_BASE}/.env.server}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-bidwright}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}" >&2
  exit 1
fi

if [[ ! -f "${DB_DUMP_PATH}" ]]; then
  echo "DB dump not found: ${DB_DUMP_PATH}" >&2
  exit 1
fi

if [[ ! -f "${DATA_ARCHIVE_PATH}" ]]; then
  echo "Data archive not found: ${DATA_ARCHIVE_PATH}" >&2
  exit 1
fi

set -a
. "${ENV_FILE}"
set +a

mkdir -p \
  "${BIDWRIGHT_DATA_PATH:-${DEPLOY_BASE}/data/app}" \
  "${POSTGRES_DATA_PATH:-${DEPLOY_BASE}/data/postgres}" \
  "${REDIS_DATA_PATH:-${DEPLOY_BASE}/data/redis}" \
  "${OLLAMA_DATA_PATH:-${DEPLOY_BASE}/data/ollama}"

compose() {
  docker compose \
    -p "${COMPOSE_PROJECT_NAME}" \
    --env-file "${ENV_FILE}" \
    -f "${APP_DIR}/docker-compose.prod.yml" \
    "$@"
}

wait_for_postgres() {
  for _ in $(seq 1 60); do
    if compose exec -T postgres pg_isready -U "${POSTGRES_USER:-bidwright}" -d "${POSTGRES_DB:-bidwright}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  echo "Postgres did not become ready in time." >&2
  return 1
}

compose up -d postgres redis ollama
wait_for_postgres

compose exec -T postgres psql -U "${POSTGRES_USER:-bidwright}" -d "${POSTGRES_DB:-bidwright}" -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null

if [[ -d "${BIDWRIGHT_DATA_PATH}" ]] && [[ -n "$(find "${BIDWRIGHT_DATA_PATH}" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
  backup_path="${BIDWRIGHT_DATA_PATH}.bak-${TIMESTAMP}"
  mv "${BIDWRIGHT_DATA_PATH}" "${backup_path}"
  mkdir -p "${BIDWRIGHT_DATA_PATH}"
  echo "Existing app data moved to ${backup_path}"
fi

find "${BIDWRIGHT_DATA_PATH}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
tar -xzf "${DATA_ARCHIVE_PATH}" -C "${BIDWRIGHT_DATA_PATH}"

cat "${DB_DUMP_PATH}" | compose exec -T postgres pg_restore \
  -U "${POSTGRES_USER:-bidwright}" \
  -d "${POSTGRES_DB:-bidwright}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges

compose run --rm db-migrate
compose up -d --build api web worker
compose ps

echo
echo "Bidwright restore completed."
