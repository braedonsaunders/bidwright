# Ubuntu Docker Deployment Notes

## Readiness Snapshot

Bidwright is close enough to move onto an Ubuntu server with Docker Compose, but it is not fully production-hardened yet.

What is already in good shape:

- Separate Dockerfiles exist for `api`, `web`, and `worker`.
- `docker-compose.prod.yml` already models the full stack.
- App file storage is centralized under `data/bidwright-api`, which makes file migration straightforward.
- PostgreSQL is already running in Docker locally, so a logical dump and restore is the safest cross-platform move.

What still needs care:

- Prisma migrations are not production-grade yet. The repo has incremental SQL migration folders, but it is missing a clean initial migration baseline and `migration_lock.toml`.
- `docker-compose.prod.yml` still relies on `prisma db push`, which is acceptable for a controlled internal move but is not the same as a hardened migration pipeline.
- You will need a reverse proxy and TLS separately if this is going on the public internet.
- The browser-facing API URL must be set explicitly with `NEXT_PUBLIC_API_BASE_URL`.

## Recommended Migration Path

Do not try to copy the Docker Postgres volume from Windows to Ubuntu. Move the data logically instead.

1. Export the local database from the running local Docker Postgres container:

```bash
docker compose exec -T postgres pg_dump -U bidwright -d bidwright --format=custom --no-owner --no-privileges > bidwright-db.dump
```

2. Copy these items to the Ubuntu server:

- the repo
- `.env`
- `bidwright-db.dump`
- the full `data/bidwright-api/` directory

3. On Ubuntu, set the browser-facing environment values in `.env` before startup:

```bash
NEXT_PUBLIC_API_BASE_URL=https://your-domain-or-ip:3001
WEB_PUBLIC_PORT=3000
API_PUBLIC_PORT=3001
```

4. Start the infrastructure first:

```bash
docker compose -f docker-compose.prod.yml up -d postgres redis ollama
```

5. Restore the database dump into the Ubuntu Postgres container:

```bash
cat bidwright-db.dump | docker compose -f docker-compose.prod.yml exec -T postgres pg_restore -U bidwright -d bidwright --clean --if-exists --no-owner --no-privileges
```

6. Make sure `data/bidwright-api/` is present beside the compose file, then start the app services:

```bash
docker compose -f docker-compose.prod.yml up -d --build api web worker
```

7. Verify all three of these before cutover:

- the web UI loads
- the browser can reach the API URL you configured
- uploaded documents, knowledge books, and project files still open correctly

## Important Notes

- Database rows alone are not enough. Bidwright stores real artifacts on disk under `data/bidwright-api`, and those files must move with the database.
- Because migrations are not fully baselined yet, test the restore on a throwaway Ubuntu VM first if this move matters operationally.
- Once the server move is stable, the next infrastructure improvement should be creating a real Prisma migration baseline and switching production deploys away from `db push`.
