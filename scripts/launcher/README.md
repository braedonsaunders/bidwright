# Bidwright launcher

Self-hosted Bidwright in three clicks. No source checkout, no Node, no pnpm —
just Docker.

## What you need

- **Docker Desktop** ([download](https://www.docker.com/products/docker-desktop/))
  running on Windows or macOS
- ~10 GB of free disk space (images + initial database + embedding model)
- About 5 minutes for the first launch

## Start

- **Windows:** double-click `start.bat`
- **macOS:** double-click `start.command` (you may need to right-click → Open
  the first time so Gatekeeper allows it)

The launcher pulls the latest images from GitHub Container Registry, starts
Postgres / Redis / Ollama / api / web / worker, waits for the web app, and
opens it in your browser at http://localhost:3000.

The first run downloads ~5 GB and pulls the embedding model. Subsequent starts
are fast.

## Stop

- **Windows:** double-click `stop.bat`
- **macOS:** double-click `stop.command`

Your projects, quotes, and uploads stay in Docker volumes — restarting picks up
where you left off.

## Update

- **Windows:** double-click `update.bat`
- **macOS:** double-click `update.command`

Pulls the latest `:latest` images and restarts. Database migrations run
automatically on the next start.

## AI provider keys

Add your Anthropic, OpenAI, or other provider keys inside the app at
**Settings → Integrations** after first launch. Keys live encrypted in your
own database — they are not read from environment variables.

If you don't add keys, the local Ollama embedding model still powers
knowledge retrieval; agent features that need a frontier LLM will be disabled
until you add a key.

## Pin a specific version

Edit `.env` (created from `.env.example` on first run) and set:

```
BIDWRIGHT_TAG=sha-abc1234
```

Then run `update.bat` / `update.command`. To roll back, change the tag and
update again.

## Change ports

If 3000 or 3001 are taken, edit `.env`:

```
WEB_PUBLIC_PORT=8000
API_PUBLIC_PORT=8001
NEXT_PUBLIC_API_BASE_URL=http://localhost:8001
```

Then `stop` and `start` again.

## Logs and shell

```bash
docker compose -p bidwright-launcher logs -f web
docker compose -p bidwright-launcher logs -f api
docker compose -p bidwright-launcher exec api sh
```

## Wipe everything

```bash
docker compose -p bidwright-launcher down -v
```

This deletes the database, uploads, and the embedding model cache. Cannot be
undone — back up first if you have real data.
