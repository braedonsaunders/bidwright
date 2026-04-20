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
    -f "${APP_DIR}/docker-compose.prod.yml" \
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

  for _ in $(seq 1 60); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  echo "Health check failed for ${url}" >&2
  return 1
}

compose_up_profiles config >/dev/null
compose up -d postgres redis
wait_for_postgres

if is_local_embeddings; then
  compose_up_profiles up -d ollama
  compose_up_profiles run --rm ollama-init
fi

compose run --rm db-migrate
compose_up_profiles up -d --build --remove-orphans api web worker

wait_for_url "http://127.0.0.1:${API_PUBLIC_PORT:-3001}/health"
wait_for_url "http://127.0.0.1:${WEB_PUBLIC_PORT:-3000}"

compose ps

echo
echo "Bidwright deploy completed from ${APP_DIR}"
