#!/usr/bin/env bash
# Bidwright launcher installer — macOS / Linux.
#
# Downloads the launcher files (compose.yml + start/stop/update scripts)
# into a folder, then starts the stack. Re-run any time to refresh the
# launcher files (image updates use update.command instead).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/braedonsaunders/bidwright/main/scripts/launcher/install.sh | bash
#
# Override the install dir:
#   BIDWRIGHT_DIR=/path/you/want bash <(curl -fsSL .../install.sh)

set -euo pipefail

INSTALL_DIR="${BIDWRIGHT_DIR:-$HOME/bidwright}"
BASE='https://raw.githubusercontent.com/braedonsaunders/bidwright/main/scripts/launcher'
FILES=(docker-compose.yml .env.example start.command stop.command update.command README.md)

echo ''
echo '======================================'
echo '   Bidwright launcher installer'
echo '======================================'
echo ''
echo "Install location: $INSTALL_DIR"
echo ''

if ! command -v docker >/dev/null 2>&1; then
  echo 'ERROR: Docker is not installed.'
  echo 'Install Docker Desktop from https://www.docker.com/products/docker-desktop/'
  echo 'then re-run this installer.'
  exit 1
fi

mkdir -p "$INSTALL_DIR"

for f in "${FILES[@]}"; do
  echo "  downloading $f"
  curl -fsSL "$BASE/$f" -o "$INSTALL_DIR/$f"
done

chmod +x "$INSTALL_DIR"/*.command

echo ''
echo "Launcher files installed to: $INSTALL_DIR"
echo ''
echo 'Starting Bidwright (first run downloads ~5 GB of images)...'
echo ''

exec "$INSTALL_DIR/start.command"
