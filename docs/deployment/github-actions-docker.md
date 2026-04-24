# GitHub Actions Docker Deployment

This guide describes the generic production deploy flow for a Docker Compose host.
Keep hostnames, private IPs, SSH users, and environment-specific port maps in
GitHub environment secrets, GitHub variables, or an untracked server-side env
file. Do not commit real infrastructure details to this repository.

## Target Layout

The deploy scripts assume a persistent base directory on the server:

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

You can override the base directory with `DEPLOY_BASE`.

## One-Time Server Prep

1. Install Docker and the Docker Compose plugin on the target host.
2. Create the deploy base directory, for example `/opt/bidwright`.
3. Place a filled-in `.env.server` at the deploy base.
   Start from [.env.server.example](../../.env.server.example), then replace
   placeholder values on the server.
4. Make sure the deploy user can write to the deploy base and run Docker.
5. Decide which public ports or reverse-proxy routes will serve the web app and API.

## One-Time Data Restore

Export local state:

```powershell
.\scripts\deploy\export-local-state.ps1
```

That creates:

- `backups/<timestamp>/bidwright-db.dump`
- `backups/<timestamp>/bidwright-data.tgz`
- `backups/<timestamp>/manifest.json`

Copy the backup artifacts to the target host with your preferred secure copy
mechanism, then restore them from the active release:

```bash
cd /opt/bidwright/current
ENV_FILE=/opt/bidwright/.env.server \
DEPLOY_BASE=/opt/bidwright \
./scripts/deploy/restore-server-state.sh \
  /opt/bidwright/bidwright-db.dump \
  /opt/bidwright/bidwright-data.tgz
```

The restore script only operates on the configured Bidwright Compose project.

## Continuous Deploys

The repo includes a GitHub Actions workflow that verifies the app, uploads a
release bundle to the target host, and runs `scripts/deploy/remote-deploy.sh`.

### Required GitHub Secrets

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`

### Optional GitHub Variables

- `DEPLOY_PORT`
  Default: `22`
- `DEPLOY_BASE`
  Default: `/opt/bidwright`
- `DEPLOY_ENV_FILE`
  Default: `/opt/bidwright/.env.server`
- `DEPLOY_COMPOSE_PROJECT_NAME`
  Default: `bidwright`
- `ENABLE_SERVER_DEPLOY`
  Set to `true` when pushes to `main` should deploy automatically.

The workflow deploys on manual dispatch, and on pushes to `main` when
`ENABLE_SERVER_DEPLOY` is `true`.

## Public Repo Safety

- Keep `.env.server`, database dumps, uploaded files, and agent auth directories
  outside the release bundle.
- Keep real hostnames, IPs, SSH usernames, and infrastructure diagrams out of
  committed docs.
- Use GitHub environment secrets for deploy credentials.
- Protect `main` with required checks and, when appropriate, a production
  environment approval.

## Agent CLI Runtime

Bidwright project agent features can shell out from the API container to Claude
Code or Codex. The production API image is expected to carry those binaries; the
host does not need them globally installed.

- Claude auth/config is persisted under `${CLAUDE_CONFIG_PATH}` and mounted at
  `${CLAUDE_CONFIG_DIR}` inside the API container.
- Codex auth/config is persisted under `${CODEX_HOME_PATH}` and mounted at
  `${CODEX_HOME}` inside the API container.
- If you use API keys instead of interactive CLI login, set them through
  Bidwright settings or server environment variables.

## Smoke Checks

After every deploy, verify:

1. The web app loads through the configured public URL.
2. The API health endpoint returns healthy JSON through the configured public URL.
3. Uploaded documents, knowledge books, knowledge pages, datasets, and project
   files still open correctly.
4. Any reverse proxy or co-hosted services on the same machine are unaffected.
