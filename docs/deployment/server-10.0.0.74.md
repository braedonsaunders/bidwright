# Bidwright Move To `10.0.0.74`

This plan is intentionally designed to avoid downtime for the existing `ADMINAPP2` stack already running on `10.0.0.74`.

## What We Know About The Host

Safe, read-only probing from the workstation showed:

- `10.0.0.74:80` is serving the default Ubuntu `nginx` welcome page.
- `10.0.0.74:8080` is redirecting into the existing admin application.
- `10.0.0.74:8081` is also in use by that existing admin application.
- `10.0.0.74:3000`, `:3001`, `:4001`, `:5432`, and `:6379` were closed during the probe.

Because of that, the Bidwright server move is configured around:

- `WEB_PUBLIC_PORT=3100`
- `API_PUBLIC_PORT=3101`
- a dedicated Docker Compose project named `bidwright`
- dedicated host storage under `/opt/bidwright`

Nothing in the Bidwright deploy path should stop, rebuild, or rebind the existing `ADMINAPP2` listeners.

## Target Layout On The Server

```text
/opt/bidwright/
  .env.server
  current -> /opt/bidwright/releases/<git-sha>
  releases/
    <git-sha>/
  data/
    app/
    agent-home/
      claude/
      codex/
    postgres/
    redis/
    ollama/
```

## One-Time Server Prep

1. Copy the repo to the server or let the GitHub deploy workflow upload the first release bundle.
2. Place a filled-in `.env.server` at `/opt/bidwright/.env.server`.
   Use [.env.server.example](../../.env.server.example) as the starting point.
3. Ensure Docker and the Compose plugin are installed on the Ubuntu host.
4. Make sure the deploy user has permission to write under `/opt/bidwright`.

## One-Time Data Migration

### 1. Export the live local state

From the Windows workstation:

```powershell
.\scripts\deploy\export-local-state.ps1
```

That creates:

- `backups/<timestamp>/bidwright-db.dump`
- `backups/<timestamp>/bidwright-data.tgz`
- `backups/<timestamp>/manifest.json`

### 2. Copy the backup artifacts to the server

Example:

```bash
scp backups/<timestamp>/bidwright-db.dump user@10.0.0.74:/opt/bidwright/
scp backups/<timestamp>/bidwright-data.tgz user@10.0.0.74:/opt/bidwright/
```

### 3. Restore the DB and files on the server

From the server, inside the active Bidwright release:

```bash
cd /opt/bidwright/current
ENV_FILE=/opt/bidwright/.env.server \
DEPLOY_BASE=/opt/bidwright \
./scripts/deploy/restore-server-state.sh \
  /opt/bidwright/bidwright-db.dump \
  /opt/bidwright/bidwright-data.tgz
```

That script only starts and touches the `bidwright` Compose project.
It does not stop or reconfigure `ADMINAPP2`.

## Continuous Deploys From GitHub

The repo includes a GitHub Actions workflow that verifies on GitHub-hosted runners and then deploys the current commit to `10.0.0.74` from a private self-hosted runner that can reach the LAN host over SSH.

### Required GitHub secrets

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`

### Optional GitHub variables

- `DEPLOY_PORT`
  Default: `22`
- `DEPLOY_BASE`
  Default: `/opt/bidwright`
- `DEPLOY_ENV_FILE`
  Default: `/opt/bidwright/.env.server`
- `ENABLE_SERVER_DEPLOY`
  Set to `true` when you want pushes to `main` to auto-deploy.

The workflow uploads a release tarball, extracts it into `/opt/bidwright/releases/<sha>`, updates `/opt/bidwright/current`, and runs `scripts/deploy/remote-deploy.sh`.

## Public Repo, Private Deploy

- The GitHub repository can stay public because deploy access is not controlled by the repo contents.
- Deployment access lives in GitHub environment secrets and variables plus the private LAN reachability of the self-hosted runner.
- Pull requests do not deploy. Only `push` to `main` and manual workflow runs can reach the deploy job.
- To keep that boundary tight, protect `main` in GitHub:
  - require pull requests
  - require the `verify` check to pass
  - restrict who can push or merge
  - require an environment approval for `production` if you want one last human gate before deploy
- Use a dedicated Bidwright deploy key/user only. Do not reuse any `ADMINAPP` key material.

## Agent CLI Runtime

Bidwright's project agent features shell out from the API container to the Claude Code CLI or Codex CLI. The production API image is expected to carry those binaries itself; the host machine does not need them globally installed.

- Claude auth/config is persisted under `${CLAUDE_CONFIG_PATH}` and mounted at `${CLAUDE_CONFIG_DIR}` inside the API container.
- Codex auth/config is persisted under `${CODEX_HOME_PATH}` and mounted at `${CODEX_HOME}` inside the API container.
- If you use API keys instead of interactive CLI login, set them through the Bidwright Integrations settings or server environment rather than baking them into the public repo.
- A redeploy should not wipe CLI auth anymore as long as those mounted directories remain intact.

Recommended production approach:

1. Install both CLIs in the API image.
2. Use per-organization `ANTHROPIC` / `OPENAI` credentials in Bidwright settings for runtime execution.
3. Treat OAuth login inside the container as optional, not the primary prod auth path.

## Smoke Checks Before Any Cutover

After the restore and again after every deploy, verify:

1. `http://10.0.0.74:3100` loads the Bidwright web app.
2. `http://10.0.0.74:3101/health` returns healthy JSON.
3. Quotes, books, project files, and workspaces from the migrated data are present.
4. `http://10.0.0.74:8080` and `https://10.0.0.74:8080` still behave exactly as before for `ADMINAPP2`.

## Important Safety Notes

- Do not bind Bidwright to `8080` or `8081`.
- Do not reuse `ADMINAPP2`'s nginx config until Bidwright is fully validated on `3100/3101`.
- Keep `.env.server` and `/opt/bidwright/data/*` outside the uploaded release bundle.
- The current server probe did not include authenticated host inspection, so before any final cutover you should still confirm with SSH what is owning `8080/8081` and whether nginx is proxying anything critical.
