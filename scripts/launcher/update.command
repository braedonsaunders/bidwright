#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PROJECT="bidwright-launcher"

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is not running. Please start Docker Desktop and try again."
  echo "Press any key to exit..."
  read -n 1
  exit 1
fi

echo "[*] Pulling latest images..."
docker compose -p "$PROJECT" pull

echo ""
echo "[*] Restarting services with the new images..."
docker compose -p "$PROJECT" up -d

echo ""
echo "[*] Update complete. Open http://localhost:3000"
echo ""
echo "Press any key to close this window..."
read -n 1
