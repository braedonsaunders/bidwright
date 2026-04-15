#!/usr/bin/env bash
# Double-click this file in Finder to build and run everything in Docker.
# Ctrl-C or close the terminal window to stop all containers.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

COMPOSE="docker compose -f docker-compose.prod.yml"

cleanup() {
  echo ""
  echo "[*] Stopping all Bidwright containers..."
  $COMPOSE down 2>/dev/null || true
  echo "[*] Stopped."
}
trap cleanup SIGINT SIGTERM EXIT

echo "======================================"
echo "       Bidwright - Starting Up"
echo "======================================"
echo ""

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is not running. Please start Docker Desktop and try again."
  echo ""
  echo "Press any key to exit..."
  read -n 1
  exit 1
fi

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "[*] Created .env from .env.example (edit to add API keys)"
  fi
fi

echo "[*] Building and starting all services (first run may take a few minutes)..."
echo ""
$COMPOSE up --build -d

echo ""
echo "[*] Waiting for services to be ready..."

for i in $(seq 1 60); do
  if curl -sf http://localhost:3000 >/dev/null 2>&1; then
    break
  fi
  sleep 2
  if [ "$i" -eq 60 ]; then
    echo "  Web service is taking a while - check '$COMPOSE logs web'"
  fi
done

echo ""
echo "======================================"
echo "        Bidwright is running"
echo ""
echo "  Web:  http://localhost:3000"
echo "  API:  http://localhost:3001"
echo "======================================"
echo ""

open http://localhost:3000 2>/dev/null || true

echo "Press Ctrl-C to stop everything."
echo ""

$COMPOSE logs -f
