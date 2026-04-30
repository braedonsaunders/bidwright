#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PROJECT="bidwright-launcher"

echo "[*] Stopping Bidwright..."
docker compose -p "$PROJECT" down
echo ""
echo "[*] Stopped. Your data is preserved in Docker volumes."
echo ""
echo "Press any key to close this window..."
read -n 1
