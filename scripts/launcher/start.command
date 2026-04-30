#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PROJECT="bidwright-launcher"

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

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
fi

echo "[*] Pulling latest images. First run downloads ~5GB and may take a while."
echo ""
if ! docker compose -p "$PROJECT" pull; then
  echo ""
  echo "ERROR: Failed to pull images. Check your internet connection."
  echo "Press any key to exit..."
  read -n 1
  exit 1
fi

echo ""
echo "[*] Starting services..."
echo ""
docker compose -p "$PROJECT" up -d

echo ""
echo "[*] Waiting for the web app to come up..."
for i in $(seq 1 120); do
  if curl -sf http://localhost:3000 >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done

echo ""
if [ "${READY:-}" = "1" ]; then
  echo "======================================"
  echo "        Bidwright is running"
  echo ""
  echo "  Web:  http://localhost:3000"
  echo "  API:  http://localhost:3001"
  echo ""
  echo "  Add your AI provider key in Settings"
  echo "  the first time you log in."
  echo "======================================"
  echo ""
  open http://localhost:3000 2>/dev/null || true
else
  echo "WARNING: The web app did not respond after 4 minutes. It may still be starting."
  echo "Run \"docker compose -p $PROJECT logs -f web\" to watch progress."
fi

echo ""
echo "To stop:    double-click stop.command"
echo "To update:  double-click update.command"
echo ""
echo "Press any key to close this window..."
read -n 1
