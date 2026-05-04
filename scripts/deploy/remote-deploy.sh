#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
APP_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd -P)"
DEPLOY_BASE="${DEPLOY_BASE:-/opt/bidwright}"
ENV_FILE="${ENV_FILE:-${DEPLOY_BASE}/.env.server}"
CURRENT_LINK="${CURRENT_LINK:-${DEPLOY_BASE}/current}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-bidwright}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}" >&2
  exit 1
fi

set -a
. "${ENV_FILE}"
set +a

# DEPLOY_MODE selects which compose file backs the stack:
#   build    — docker-compose.prod.yml, builds images on this host (legacy)
#   registry — docker-compose.prod-registry.yml, pulls images from GHCR
# Default is build so an unconfigured server keeps the legacy behaviour.
DEPLOY_MODE="${DEPLOY_MODE:-build}"

if [[ "${DEPLOY_MODE}" == "registry" ]]; then
  COMPOSE_FILE="${COMPOSE_FILE:-${APP_DIR}/docker-compose.prod-registry.yml}"
elif [[ "${DEPLOY_MODE}" == "build" ]]; then
  COMPOSE_FILE="${COMPOSE_FILE:-${APP_DIR}/docker-compose.prod.yml}"
else
  echo "Unsupported DEPLOY_MODE: ${DEPLOY_MODE} (expected 'build' or 'registry')" >&2
  exit 1
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "Missing compose file: ${COMPOSE_FILE}" >&2
  exit 1
fi

echo "Deploy mode: ${DEPLOY_MODE}"
echo "Compose file: ${COMPOSE_FILE}"
if [[ "${DEPLOY_MODE}" == "registry" ]]; then
  echo "Image tag: ${BIDWRIGHT_TAG:-latest} from ${BIDWRIGHT_REGISTRY:-ghcr.io/braedonsaunders}"
fi

mkdir -p \
  "${DEPLOY_BASE}/releases" \
  "${BIDWRIGHT_DATA_PATH:-${DEPLOY_BASE}/data/app}" \
  "${POSTGRES_DATA_PATH:-${DEPLOY_BASE}/data/postgres}" \
  "${REDIS_DATA_PATH:-${DEPLOY_BASE}/data/redis}" \
  "${OLLAMA_DATA_PATH:-${DEPLOY_BASE}/data/ollama}"

ln -sfn "${APP_DIR}" "${CURRENT_LINK}"

compose() {
  docker compose \
    -p "${COMPOSE_PROJECT_NAME}" \
    --env-file "${ENV_FILE}" \
    -f "${COMPOSE_FILE}" \
    "$@"
}

is_local_embeddings() {
  [[ "${EMBEDDING_PROVIDER:-local}" == "local" ]]
}

compose_up_profiles() {
  if is_local_embeddings; then
    compose --profile embeddings "$@"
  else
    compose "$@"
  fi
}

cleanup_db_migrate_container() {
  compose rm -f -s db-migrate >/dev/null 2>&1 || true
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

wait_for_url() {
  local url="$1"
  local service="${2:-}"

  for _ in $(seq 1 90); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  echo "Health check failed for ${url}" >&2
  if [[ -n "${service}" ]]; then
    echo "─── Last 200 lines from ${service} container ───" >&2
    compose logs --no-color --tail 200 "${service}" >&2 || true
    echo "─── End ${service} logs ───" >&2
  fi
  return 1
}

smoke_pdf_generation() {
  compose exec -T api node --input-type=module -e '
    const { generatePdfBuffer } = await import("./apps/api/dist/apps/api/src/services/pdf-service.js");
    const result = await generatePdfBuffer("<!doctype html><html><body><h1>Bidwright PDF smoke</h1></body></html>");
    const signature = result.buffer.subarray(0, 5).toString("utf8");
    if (result.contentType !== "application/pdf" || signature !== "%PDF-") {
      throw new Error(`Expected PDF bytes, got ${result.contentType} ${signature}`);
    }
    console.log(`PDF smoke ok: ${result.buffer.length} bytes`);
    process.exit(0);
  '
}

compose_up_profiles config >/dev/null

# Registry mode: fail fast if images aren't available before we touch the running stack.
if [[ "${DEPLOY_MODE}" == "registry" ]]; then
  echo "Pulling images from registry..."
  compose_up_profiles pull
fi

compose up -d postgres redis
wait_for_postgres

if is_local_embeddings; then
  compose_up_profiles up -d ollama
  compose_up_profiles run --rm ollama-init
fi

# Build mode rebuilds the migrate image from source; registry mode reuses
# the runtime API image, so no build step is needed.
if [[ "${DEPLOY_MODE}" == "build" ]]; then
  compose build db-migrate
fi
cleanup_db_migrate_container
compose run --rm db-migrate
compose run --rm db-migrate sh -lc "pnpm --filter @bidwright/db exec tsx src/run-seed-plugins.ts"

if [[ "${DEPLOY_MODE}" == "build" ]]; then
  compose_up_profiles up -d --build --remove-orphans api web worker
else
  compose_up_profiles up -d --remove-orphans api web worker
fi
cleanup_db_migrate_container

wait_for_url "http://127.0.0.1:${API_PUBLIC_PORT:-3001}/health" "api"
wait_for_url "http://127.0.0.1:${WEB_PUBLIC_PORT:-3000}" "web"
smoke_pdf_generation

compose ps

echo
echo "Bidwright deploy completed from ${APP_DIR}"
