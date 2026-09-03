# Getting started

Prefer a local or desktop install. The hosted demo can return 502 and is not the reliable path right now.

This page covers first launch for estimators who already have the desktop installer, or who want the Docker launcher from the README. Contributors who need the monorepo can skip to [Develop from source](#develop-from-source).

## Option A: Desktop app (no Docker)

The desktop build is an Electron shell that starts embedded Postgres, the API, and the web app for you. Download the latest installer from [GitHub Releases](https://github.com/braedonsaunders/bidwright/releases) (Windows Setup `.exe`, macOS `.dmg`, or Linux `.AppImage`).

1. Install and launch Bidwright.
2. Wait for the window to open. First boot can take a minute while the local database comes up.
3. If no super admin exists yet, the first-run setup wizard opens automatically.

Then continue with [First-run wizard](#first-run-wizard).

## Option B: Docker launcher (Windows PowerShell)

You only need Docker Desktop. The installer drops a few launcher files into `~/bidwright` and starts the stack. No source checkout.

```powershell
iwr -useb https://raw.githubusercontent.com/braedonsaunders/bidwright/main/scripts/launcher/install.ps1 | iex
```

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/braedonsaunders/bidwright/main/scripts/launcher/install.sh | bash
```

The launcher opens the app at http://localhost:3000. More detail lives in [scripts/launcher/README.md](../scripts/launcher/README.md).

Once the stack is up, desktop and Docker users hit the same first-run wizard.

## First-run wizard

When no super admin exists, Bidwright opens setup. The walkthrough:

1. Creates the system owner (super admin).
2. Creates the first organization (name and URL slug).
3. Offers sample data. Load it when prompted so you have projects, quotes, catalogs, rates, customers, and departments to poke at.

Required estimating categories are created either way. Sample data is optional but recommended for a first session.

If setup already finished and the org looks empty, you can still load sample data later from the admin organizations screen.

## After setup

A simple loop:

1. Open a project (sample data includes some, or create one).
2. Drop a bid package into intake.
3. Work the estimate from there: takeoff, worksheet, then quote.

Feature overview is in the [README](../README.md#features).

Optional: add Anthropic, OpenAI, or other provider keys under **Settings → Integrations** if you want agent features that need a frontier LLM. Local Ollama embeddings still power knowledge retrieval without those keys on the Docker launcher path.

## If the desktop app will not reopen

On Windows, closing the window can leave `postgres.exe` or the web sidecar running. In Task Manager, end Bidwright, `postgres.exe`, and any leftover node still under Bidwright, then launch again.

Logs live in `%APPDATA%\Bidwright\logs`. If a second launch dies with `ENVIRONMENT_FALLBACK` after Next says ready, that is usually this leftover-process case. Paste the newest `web-*.log` on a GitHub issue if it still fails.

## Develop from source

For contributors editing code. Needs Node.js 20+, pnpm 10+, and Docker Desktop.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

On Windows: `pnpm dev:windows`.

After startup, web is at http://localhost:3000 and API at http://localhost:4001. Same first-run wizard as above if no super admin exists yet.
