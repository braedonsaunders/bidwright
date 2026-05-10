# Bidwright Desktop

Electron-native single-user shell. Bundles embedded Postgres + the
Fastify API + the Next.js web app so a non-technical estimator can
install one `.dmg` / `.exe` / `.AppImage` and launch the product
without touching Docker or a terminal.

## Two startup paths

| Path        | When                          | What it does                                                              |
| ----------- | ----------------------------- | ------------------------------------------------------------------------- |
| **Dev**     | `BIDWRIGHT_DESKTOP_DEV=true` (or `electron .` from source) | Skips embedded Postgres + bundled servers; opens a BrowserWindow pointed at `http://localhost:3000`. Use this while iterating on UI — pair with `pnpm dev` in another terminal. |
| **Packaged** | `.dmg` / `.exe` / `.AppImage` launched by an end user | (1) Boot embedded Postgres into the user's `userData` dir; (2) apply Prisma migrations; (3) start the Fastify API in-process; (4) spawn the Next.js standalone server as a child via `ELECTRON_RUN_AS_NODE`; (5) wait for the web server to answer HTTP, then open the window. |

The discriminator is `app.isPackaged`. Both paths converge on the same
`createMainWindow(webUrl)` once their server endpoints are healthy.

## Local dev workflow

```bash
# Terminal 1 — start the API + Web + Postgres
pnpm dev

# Terminal 2 — open the Electron shell against them
pnpm --filter @bidwright/desktop dev
```

The window opens at `http://localhost:3000`. External links open in the
user's default browser; same-origin links stay inside the Electron shell.
Devtools, reload, zoom, fullscreen all map to the standard Cmd/Ctrl
shortcuts via the trimmed application menu.

## Building distributable artifacts

```bash
# 1. Build the api + web upstream (their `build` scripts run independently)
pnpm --filter @bidwright/api build
pnpm --filter @bidwright/web build

# 2. Build the desktop main + run electron-builder
pnpm --filter @bidwright/desktop dist:dir   # unsigned .app/.exe/.AppImage in apps/desktop/release
pnpm --filter @bidwright/desktop dist        # signed installer set (needs platform-specific certs)
```

The bundle structure inside `Bidwright.app/Contents/Resources/`:

```
api/                  ← @bidwright/api dist (Fastify, Prisma client, services)
web/standalone/...    ← Next.js standalone build (preserves workspace path layout)
migrations/           ← Prisma migrations applied on first launch
app/                  ← desktop main + node_modules including embedded-postgres native bin
```

Total bundle size is ~885 MB on macOS arm64 because Electron itself is
~250 MB, the api node_modules graph (Playwright, pdfjs, ifcjs, etc.)
adds another ~400 MB, and the embedded-postgres binary is ~150 MB.

## Cross-platform release

Code-signed `.dmg` / `.exe` / `.AppImage` builds need platform-specific
prerequisites:

| Platform | Requirement                                                                  |
| -------- | ---------------------------------------------------------------------------- |
| macOS    | Apple Developer ID + a Notarization API key. Set `CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` before running `pnpm dist`. |
| Windows  | An Authenticode certificate (EV preferred so SmartScreen accepts the binary). Set `CSC_LINK` / `CSC_KEY_PASSWORD`. |
| Linux    | Nothing required for an unsigned `.AppImage`; for distro packages (`.deb`, `.rpm`) add maintainer details and run on a Linux build host. |

We use `electron-builder` 25.x. Its full reference is at
<https://www.electron.build/configuration>.

`build.asar = false` is intentional — Electron-builder's asar packer
follows pnpm workspace symlinks (`node_modules/@bidwright/db` →
`packages/db`) and refuses to pack files outside the desktop package
root. The standard fix is `pnpm deploy --prod <staging-dir>` to a
flattened tree before running electron-builder; that's a follow-up
once we add a `dist:staging` script. Until then the bundle is unpacked,
which is slightly larger but functionally identical.

## Releasing via CI

Push a `desktop-v*` tag and `.github/workflows/desktop-release.yml`
matrix-builds across macOS / Linux / Windows in parallel, then uploads
the installers to a **draft** GitHub Release. A maintainer reviews +
publishes; auto-update only sees the release once it's published, so
unverified builds never hit existing installs.

```bash
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
# …watch the Actions tab; release lands in `Releases / Drafts`
```

The workflow also exposes `workflow_dispatch` so you can dry-run a
matrix build without cutting a release. Provide an empty `tag` input
and the build artifacts will land as workflow artifacts (14-day
retention) without creating a Release.

The first time you tag, the build will be **unsigned** because no
signing secrets are set. Gatekeeper / SmartScreen will warn users on
install. Wire the secrets (table below) and re-tag to ship a signed
build that auto-update can apply silently.

## Auto-update

Wired via `electron-updater` against the `publish: github` feed in
`apps/desktop/package.json`. On every packaged-mode launch:

1. Fetches `latest-mac.yml` / `latest.yml` / `latest-linux.yml` from
   the latest **published** GitHub Release.
2. If a newer version exists, downloads in the background and shows a
   "Restart now to update?" dialog when ready.
3. Falls through silently when offline / no release published yet.

Dev launches (`BIDWRIGHT_DESKTOP_DEV=true`) skip the update check.

## Known gaps for v1

1. **pgvector** — embedded-postgres ships plain Postgres binaries
   without the `vector` extension. The desktop bootstrap tries
   `CREATE EXTENSION vector` on every launch and falls back gracefully
   when it isn't available — semantic search degrades to text-only via
   the api's existing fallback path in
   [`apps/api/src/services/knowledge-service.ts`](../apps/api/src/services/knowledge-service.ts).
   Estimating, agent runs, and document ingestion all keep working
   without pgvector. To get true semantic search in the desktop bundle,
   rebuild a custom `embedded-postgres` binary that includes pgvector,
   or drop a prebuilt `vector.dylib` / `vector.so` / `vector.dll` into
   the postgres extension dir. Tracked as a v2 enhancement.
2. **Tray icon + OS notifications** — not implemented. Re-add a
   preload script as `preload.cts` (CommonJS — Electron's preload
   sandbox loader doesn't support ESM) when the IPC surface lands.
3. **Code signing certs** — workflow has the env vars wired (CSC_LINK,
   APPLE_ID, etc.) but the secrets aren't set in repo settings yet.
   Without them, builds finish but installers are unsigned. See the
   "Cross-platform release" table above for what each platform needs.

## Architecture notes

- Single-instance lock: `app.requestSingleInstanceLock()` — opening a
  second copy focuses the existing window instead of starting another
  Postgres on a different port (the second cluster would silently fail
  the data-dir lock and leave the user with a blank window).
- API runs **in-process** with the Electron main process via direct
  module import. Saves a child-process boundary; same Node version
  applies. Web runs as a child because the Next.js standalone server
  expects to be `node server.js` and we don't want to mix Next's
  request lifecycle with the Electron event loop.
- All ports are dynamic — `getAvailablePort()` asks the OS for an
  ephemeral port for Postgres, the API, and the Next server. Avoids
  conflicts with anything else the user runs locally.
- Failure to boot any step shows an Electron error dialog and quits
  cleanly rather than leaving a window in a half-broken state. The
  `before-quit` hook stops the web sidecar + API + Postgres in order.
