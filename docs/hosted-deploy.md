# Hosted SaaS deployment

Single-host (or fronted by a load balancer) deployment of Bidwright as a
multi-tenant hosted product. Each user signs up via `https://<your-domain>/signup`,
gets their own organization, and runs CLI agent sessions inside a per-user
bubblewrap sandbox. Project workspaces snapshot to Cloudflare R2 between
sessions so users follow the api pool transparently.

This document covers the hosted shape (`docker-compose.hosted.yml`).
For single-user desktop or single-tenant self-host, see the root README.

## What you need

| Resource                 | Why                                          |
| ------------------------ | -------------------------------------------- |
| A public Linux host      | Runs the compose stack. 4 vCPU / 8 GB RAM is fine for a small tenant base; scale CPU as concurrent CLI sessions grow. |
| A domain                 | TLS via Let's Encrypt; DNS A record at the host's public IP before first start. |
| Cloudflare R2 bucket     | Project workspace snapshots. Free tier covers ~10 GB; egress is free. |
| A long-random `INTEGRATIONS_ENCRYPTION_KEY` | Encrypts org-wide integration keys at rest in Postgres. Generate once with `openssl rand -base64 32`; pin from a secret store. |
| (Optional) Anthropic / OpenAI API keys | Org-wide fallback for users who don't bring their own. Per-user OAuth via `/profile/credentials` is the preferred path. |

R2 setup, end-to-end:

1. In the Cloudflare dashboard → R2 → create a bucket (e.g. `bidwright-workspaces`).
2. Account-scoped API token: R2 → Manage R2 API tokens → Create token →
   "Object Read & Write" on this bucket only.
3. Note the **Access Key ID**, **Secret**, and the S3 endpoint
   (`https://<account-id>.r2.cloudflarestorage.com`) — all three go into
   `.env.hosted`.

## First boot

```bash
# 1. Clone Bidwright on the host
git clone <repo> bidwright && cd bidwright

# 2. Create .env.hosted (alongside docker-compose.hosted.yml)
cat > .env.hosted <<'EOF'
HOSTED_DOMAIN=bidwright.example.com
HOSTED_ADMIN_EMAIL=admin@example.com

POSTGRES_USER=bidwright
POSTGRES_PASSWORD=<openssl rand -base64 32>
POSTGRES_DB=bidwright

WORKSPACE_S3_BUCKET=bidwright-workspaces
WORKSPACE_S3_REGION=auto
WORKSPACE_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
WORKSPACE_S3_ACCESS_KEY_ID=<R2 token id>
WORKSPACE_S3_SECRET_ACCESS_KEY=<R2 token secret>
WORKSPACE_S3_PREFIX=bidwright/workspaces
WORKSPACE_S3_FORCE_PATH_STYLE=false

INTEGRATIONS_ENCRYPTION_KEY=<openssl rand -base64 32>

# Optional org-wide fallback API keys; per-user OAuth wins when set.
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
EOF

# 3. Point DNS at the host (A record for HOSTED_DOMAIN). Verify it resolves.

# 4. Boot the stack — Caddy provisions TLS automatically on first start
docker compose --env-file .env.hosted -f docker-compose.hosted.yml up -d

# 5. Tail logs to watch the migration + Caddy + first health checks
docker compose --env-file .env.hosted -f docker-compose.hosted.yml logs -f
```

`https://<HOSTED_DOMAIN>` should be live within ~60s of `up -d` (most of
that is Let's Encrypt rate-limit-friendly DNS-01 / HTTP-01 negotiation).

## Things to verify after first boot

- `https://<HOSTED_DOMAIN>/health` returns 200 (api is reachable through Caddy).
- `https://<HOSTED_DOMAIN>/signup` renders. Create the first admin org from
  the UI — there's no separate bootstrap script.
- A test session: log in, create a project, kick off an estimate. Confirm
  in `docker logs` that the api logged `[cli:spawn:bwrap] cmd=…` and
  `[workspace-storage] snapshot ok: key=org/<orgId>/projects/<projectId>`.
- After the snapshot logs, manually delete the api container's local copy:
  `docker compose exec api rm -rf /data/bidwright-api/projects/<projectId>`.
  Re-run a session for the same project — the api should log
  `[cli:spawn] restored workspace from snapshot key=…` and the agent
  should see the previous SCOPE.md / .bidwright/session.json.
- Sign up a second user (different email) in the same org or a new org.
  Confirm in `/data/agent-home/users/` that two namespaces exist and
  contain only that user's `.claude/`.

## Operational notes

**TLS renewal** — Caddy renews automatically. `caddydata` is a named
volume; back it up if you don't want to re-issue on volume loss.

**Postgres backups** — `pgdata` is a named volume on the host. Schedule
`pg_dump` via cron or use a managed Postgres provider; Bidwright's
`OrganizationSettings.integrations` JSON contains org admin API keys
(encrypted at rest by `INTEGRATIONS_ENCRYPTION_KEY`) and
`UserSettings.integrations` contains per-user OAuth tokens (also
encrypted), so backups need the same protection as the encryption key.

**Per-org quotas** — `OrganizationSettings.maxUsers`, `maxProjects`,
`maxStorage`, `maxKnowledgeBooks` are admin-settable today (super-admin
console). Wire your billing system to flip these as plans change.

**Scaling out** — single-host is the v1 shape. The api is stateless
because workspaces snapshot to R2 and credentials live in Postgres, so
you can run multiple `api` replicas behind any L4/L7 load balancer; just
keep `web` and `worker` count == api count for a clean compose. Sticky
sessions are not required — the workspace-restore path covers a user
landing on a fresh host.

**Egress allowlist** — every CLI sandbox routes outbound traffic through
the in-process egress proxy. Default allowlist (in
`apps/api/src/services/egress-proxy.ts`) covers Anthropic / OpenAI /
Google / OpenRouter / GitHub / npm / pypi. Extend by setting
`process.env.WORKSPACE_S3_ENDPOINT` (auto-allowlisted) or by editing the
default list and rebuilding the api image.

**bwrap requires** `cap_add: SYS_ADMIN` and relaxed seccomp/apparmor on
the api container — already set in `docker-compose.hosted.yml`. These
caps are scoped to the api container only; bwrap drops all caps before
exec'ing the actual CLI child, so a sandboxed agent does not inherit
them.

## Rolling back

The api image is pulled by tag (`BIDWRIGHT_TAG` in `.env.hosted`,
defaults to `:latest`). Pin a SHA-tagged release for production and roll
back with:

```bash
BIDWRIGHT_TAG=sha-abc1234 \
  docker compose --env-file .env.hosted -f docker-compose.hosted.yml up -d
```

Migrations are forward-only; `prisma migrate deploy` runs on every boot
via the `db-migrate` one-shot service. If a migration is destructive and
you need to roll the schema back too, restore Postgres from backup and
then redeploy with the older tag.
