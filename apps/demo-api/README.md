# Bidwright public demo runtime

Cloudflare Worker + Cloudflare Container runtime for the public Bidwright demo.

This app no longer re-implements product routes. The Worker only handles CORS and proxies traffic into a sleeping Cloudflare Container running the real `@bidwright/api` backend from this monorepo. The container points at the Supabase demo Postgres database and enables API-side demo mode so unauthenticated visitors resolve to the seeded `Bidwright Demo` organization and user.

## What still runs for the demo

- Real Fastify API server from `apps/api`
- Real Prisma/Postgres data model from `packages/db`
- Real quote, project, client, worksheet, line-item, phase, condition, factor, summary, rate, and catalog logic
- Real server-side calculations and workspace persistence

## What is intentionally disabled

- AI agent and agent CLI runtime
- Account signup/login/profile mutation
- Admin routes
- Uploads, package ingest, and file ingest
- Vision, takeoff processing, model ingest, and DWG processing
- Email delivery and quote sending
- PDF generation
- External integrations and plugin execution

The web app should also run with `NEXT_PUBLIC_BIDWRIGHT_DEMO=1` so it hides or explains those disabled areas before users click into them.

## Deploy shape

- `apps/web` deploys to Vercel.
- `NEXT_PUBLIC_API_BASE_URL` points at this Worker URL, currently `https://bidwright-demo-api.bsaunders.workers.dev`.
- `apps/demo-api` deploys a Worker named `bidwright-demo-api`.
- `Dockerfile.demo-api` builds a lean real-API container image for Cloudflare Containers.
- Supabase hosts the demo Postgres database.

## Required Worker secrets

Set these on the Cloudflare Worker:

```sh
wrangler secret put DATABASE_URL
wrangler secret put INTEGRATIONS_ENCRYPTION_KEY
```

`DATABASE_URL` should be the Supabase pooler connection string. `INTEGRATIONS_ENCRYPTION_KEY` must be a stable base64 32-byte key so encrypted settings remain readable across cold starts.

## Commands

```sh
pnpm install
pnpm --filter @bidwright/demo-api typecheck
pnpm deploy:demo-api
```

`wrangler deploy` builds and pushes the container image using local Docker, then deploys the Worker that proxies to it.

## Automatic deploys

`.github/workflows/demo-api-deploy.yml` redeploys the demo runtime on `main` when the real API, demo Worker, Dockerfile, database package, or shared packages change.

Required GitHub repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
