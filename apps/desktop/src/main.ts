/**
 * Bidwright Desktop — Electron main process.
 *
 * Two distinct startup paths gated on `app.isPackaged`:
 *
 *   • Dev (BIDWRIGHT_DESKTOP_DEV=true or `electron .` from source):
 *     assume the operator already has `pnpm dev` running (Postgres in
 *     docker-compose, Fastify on :4001, Next on :3000). The Electron
 *     window just points at http://localhost:3000 and provides a
 *     close-to-production shell for UI iteration.
 *
 *   • Packaged (.dmg / .exe / .AppImage launched by an end user):
 *     bundle EVERYTHING. Boot embedded Postgres into the user's app-data
 *     dir, apply Prisma migrations, start the Fastify API in-process,
 *     spawn the Next.js standalone server as a child, then open the
 *     window once both endpoints are healthy. This is the "no Docker, no
 *     terminal" zero-config experience.
 *
 * Crash semantics: any failure in the boot chain shows a fatal error
 * dialog and quits. We deliberately don't recover automatically because
 * the user has no way to know what state the cluster is in; better to
 * surface the failure cleanly so they can re-launch.
 */

import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getAvailablePort, waitForHttpReady } from "./port-utils.js";
import { initPgvectorIfAvailable } from "./pgvector-init.js";
import { wireAutoUpdater } from "./auto-updater.js";

// ── Constants ─────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEV_WEB_URL =
  process.env.BIDWRIGHT_DESKTOP_DEV_URL || "http://localhost:3000";
const APP_NAME = "Bidwright";

// Paths inside the packaged bundle (set up by electron-builder
// extraResources). `process.resourcesPath` resolves to e.g.
//   macOS:   /Applications/Bidwright.app/Contents/Resources
//   Linux:   <appimage mount>/resources
//   Windows: C:\Program Files\Bidwright\resources
function packagedResource(...segments: string[]): string {
  return resolve(process.resourcesPath, ...segments);
}

// Paths under the user's app-data dir — Postgres cluster, runtime
// workspace, secrets. Created on first launch; survives upgrades because
// app-data is per-user, not per-install.
function userDataPath(...segments: string[]): string {
  return resolve(app.getPath("userData"), ...segments);
}

interface BootedServers {
  apiPort: number;
  apiUrl: string;
  webPort: number;
  webUrl: string;
  pg: { stop: () => Promise<void> } | null;
  apiProcess: ChildProcess | null;
  webProcess: ChildProcess | null;
}

let booted: BootedServers | null = null;
let mainWindow: BrowserWindow | null = null;

// ── Boot: dev path ────────────────────────────────────────────────

async function bootDev(): Promise<BootedServers> {
  // Wait briefly for the dev web server to come up — many users `pnpm dev`
  // and `pnpm --filter desktop dev` in two terminals; the web server is
  // sometimes still warming up Turbopack when Electron launches.
  console.log(`[desktop] dev mode — waiting on ${DEV_WEB_URL}`);
  await waitForHttpReady(DEV_WEB_URL, { timeoutMs: 60_000 }).catch((err) => {
    throw new Error(
      `Bidwright Desktop (dev) couldn't reach ${DEV_WEB_URL} within 60s. Run \`pnpm dev\` first, then retry.\n\nDetail: ${
        err instanceof Error ? err.message : err
      }`,
    );
  });
  return {
    apiPort: Number(process.env.BIDWRIGHT_DESKTOP_API_PORT || 4001),
    apiUrl: process.env.BIDWRIGHT_DESKTOP_API_URL || "http://localhost:4001",
    webPort: 3000,
    webUrl: DEV_WEB_URL,
    pg: null,
    apiProcess: null,
    webProcess: null,
  };
}

/**
 * Resolve the absolute path to the bundled @bidwright/api entry script.
 * In a packaged build the workspace dep ships at
 *   Resources/app/node_modules/@bidwright/api/
 * with `dist/apps/api/src/index.js` inside it (emitted by `tsc` during
 * the desktop release CI's `pnpm --filter @bidwright/api build` step).
 * `import.meta.resolve` works in ESM and is the most portable way to
 * locate the package without hard-coding bundle paths that differ
 * between asar / asar-unpacked / dir builds and across platforms.
 */
function resolveApiEntryScript(): string {
  const pkgUrl = import.meta.resolve("@bidwright/api/package.json");
  const pkgPath = fileURLToPath(pkgUrl);
  return join(dirname(pkgPath), "dist", "apps", "api", "src", "index.js");
}

// ── Boot: packaged path ───────────────────────────────────────────

async function bootPackaged(): Promise<BootedServers> {
  // 1. Embedded Postgres ----------------------------------------------------
  const databaseDir = userDataPath("postgres");
  await mkdir(databaseDir, { recursive: true });
  const pgPort = await getAvailablePort();
  const pgPassword = process.env.BIDWRIGHT_DESKTOP_PG_PASSWORD || "bidwright";

  console.log(`[desktop] starting embedded postgres on 127.0.0.1:${pgPort}`);
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: "bidwright",
    password: pgPassword,
    port: pgPort,
    persistent: true,
  });

  if (!existsSync(join(databaseDir, "PG_VERSION"))) {
    // First launch — initialise the cluster. ~2-5s on SSD.
    console.log(`[desktop] initialising fresh Postgres cluster at ${databaseDir}`);
    await pg.initialise();
  }
  await pg.start();
  await pg.createDatabase("bidwright").catch(() => {
    // Ignore "already exists" — createDatabase is idempotent in spirit
    // even if the underlying CREATE DATABASE isn't.
  });

  const databaseUrl = `postgresql://bidwright:${encodeURIComponent(pgPassword)}@127.0.0.1:${pgPort}/bidwright`;
  process.env.DATABASE_URL = databaseUrl;
  process.env.DATA_DIR = userDataPath("api-data");
  process.env.BIDWRIGHT_MODE = "desktop";
  process.env.BIDWRIGHT_MULTITENANT = "false";
  process.env.AGENT_HOME_ROOT = userDataPath("agent-home");
  // The packaged Bidwright api expects to find prisma migrations relative
  // to /app, but the bundled location moves to extraResources/migrations.
  process.env.BIDWRIGHT_MIGRATIONS_DIR = packagedResource("migrations");

  // 2. Apply migrations -----------------------------------------------------
  console.log(`[desktop] applying Prisma migrations`);
  await applyPrismaMigrations(databaseUrl);

  // 2b. Try to enable pgvector + create the vector_records table.
  //     Vanilla Postgres binaries (which embedded-postgres ships) don't
  //     include pgvector; we attempt the extension and fall through if
  //     it isn't installable. The api's knowledge-service has a graceful
  //     text-search fallback when vector_records is missing, so a desktop
  //     install without pgvector keeps working — just with text-only
  //     semantic search instead of hybrid.
  await initPgvectorIfAvailable({
    databaseUrl,
    initSqlPath: packagedResource("init-pgvector.sql"),
  });

  // 3. Spawn the Fastify api as a child process ----------------------------
  // We deliberately don't import @bidwright/api in-process. The packaged
  // bundle layout (workspace dep at Resources/app/node_modules/@bidwright/api,
  // its compiled dist/ inside that, peer deps at Resources/app/node_modules/)
  // resolves cleanly when Node spawns the entry script directly with
  // ELECTRON_RUN_AS_NODE — but in-process ESM `import("@bidwright/api/...")`
  // hits ERR_MODULE_NOT_FOUND on Windows installers (and intermittently on
  // mac-arm64 dist:dir builds) because Electron's renderer-context resolver
  // diverges from a fresh Node invocation. The child-process spawn matches
  // the pattern that already works for the Next.js sidecar below.
  const apiPort = await getAvailablePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  process.env.API_PORT = String(apiPort);

  const apiServerScript = resolveApiEntryScript();
  if (!existsSync(apiServerScript)) {
    throw new Error(
      `Bidwright Desktop bundle is missing the api server at ${apiServerScript}. ` +
        `electron-builder should have copied @bidwright/api's dist into the bundle. ` +
        `Verify the upstream "pnpm --filter @bidwright/api build" step ran before packaging.`,
    );
  }
  console.log(`[desktop] spawning Fastify api on 127.0.0.1:${apiPort} from ${apiServerScript}`);

  const apiProcess = spawn(process.execPath, [apiServerScript], {
    cwd: dirname(apiServerScript),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiProcess.stdout?.on("data", (chunk) => process.stdout.write(`[api] ${chunk}`));
  apiProcess.stderr?.on("data", (chunk) => process.stderr.write(`[api] ${chunk}`));
  apiProcess.on("exit", (code, signal) => {
    console.error(`[desktop] api process exited code=${code} signal=${signal}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        "Bidwright stopped",
        "The Bidwright api server exited unexpectedly. Please reopen the app.",
      );
      app.quit();
    }
  });

  await waitForHttpReady(`${apiUrl}/health`, { timeoutMs: 60_000 });

  // 4. Spawn Next.js standalone server -------------------------------------
  const webPort = await getAvailablePort();
  const webUrl = `http://127.0.0.1:${webPort}`;
  // Next.js standalone preserves the source workspace path layout inside
  // the build output (e.g. `apps/web/server.js` for normal monorepos,
  // `.claude/worktrees/<name>/apps/web/server.js` when built from a git
  // worktree). Rather than hard-coding either, find server.js by walking
  // the bundled standalone tree once at boot.
  const standaloneRoot = packagedResource("web", "standalone");
  const standaloneServer = await findStandaloneServer(standaloneRoot);
  if (!standaloneServer) {
    throw new Error(
      `Bidwright Desktop bundle is missing the web server under ${standaloneRoot}. ` +
        `electron-builder.extraResources should include apps/web/.next/standalone.`,
    );
  }
  console.log(`[desktop] spawning Next standalone on 127.0.0.1:${webPort}`);
  const webProcess = spawn(process.execPath, [standaloneServer], {
    cwd: dirname(standaloneServer),
    env: {
      ...process.env,
      // ELECTRON_RUN_AS_NODE makes Electron's own node binary behave
      // like vanilla node — no GUI startup. Avoids bundling a separate
      // node binary for the web sidecar.
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(webPort),
      HOSTNAME: "127.0.0.1",
      NEXT_PUBLIC_API_BASE_URL: apiUrl,
      INTERNAL_API_BASE_URL: apiUrl,
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  webProcess.stdout?.on("data", (chunk) =>
    process.stdout.write(`[web] ${chunk}`),
  );
  webProcess.stderr?.on("data", (chunk) =>
    process.stderr.write(`[web] ${chunk}`),
  );
  webProcess.on("exit", (code, signal) => {
    console.error(`[desktop] Next standalone exited code=${code} signal=${signal}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Web is the only thing the user sees — if it crashed, surface
      // the failure rather than leaving a blank window.
      dialog.showErrorBox(
        "Bidwright stopped",
        "The Bidwright web server exited unexpectedly. Please reopen the app.",
      );
      app.quit();
    }
  });

  await waitForHttpReady(webUrl, { timeoutMs: 30_000 });

  return {
    apiPort,
    apiUrl,
    webPort,
    webUrl,
    pg: { stop: () => pg.stop() },
    apiProcess,
    webProcess,
  };
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Locate `apps/web/server.js` somewhere under a bundled Next.js
 * standalone output. We search shallowly first (the common case where
 * the path is `apps/web/server.js`), then walk the tree for worktree
 * builds where `.claude/worktrees/<name>/apps/web/server.js` is the
 * actual location.
 */
async function findStandaloneServer(root: string): Promise<string | null> {
  if (!existsSync(root)) return null;
  const direct = join(root, "apps", "web", "server.js");
  if (existsSync(direct)) return direct;
  const { readdir } = await import("node:fs/promises");
  const { Dirent } = await import("node:fs");
  const queue: string[] = [root];
  // Cap the search depth so a misconfigured bundle doesn't walk the
  // entire app FS hunting for a server.js that isn't there.
  let visited = 0;
  while (queue.length > 0 && visited < 256) {
    const dir = queue.shift()!;
    visited += 1;
    let entries: InstanceType<typeof Dirent>[];
    try {
      entries = (await readdir(dir, { withFileTypes: true })) as InstanceType<typeof Dirent>[];
    } catch {
      continue;
    }
    for (const entry of entries) {
      const name = String(entry.name);
      if (name === "node_modules") continue;
      const full = join(dir, name);
      if (entry.isDirectory()) {
        queue.push(full);
        continue;
      }
      if (name === "server.js" && full.endsWith(join("apps", "web", "server.js"))) {
        return full;
      }
    }
  }
  return null;
}

async function applyPrismaMigrations(databaseUrl: string): Promise<void> {
  // Spawn `prisma migrate deploy` as a one-shot using Electron's own
  // node. The prisma binary lives under @bidwright/db's node_modules in
  // the packaged app (asar-unpacked, so it's executable).
  const dbModuleRoot = packagedResource("api", "node_modules", "@bidwright", "db");
  const prismaCli = packagedResource(
    "api",
    "node_modules",
    "prisma",
    "build",
    "index.js",
  );
  if (!existsSync(prismaCli)) {
    // In dev / dir-mode builds we skip migrations; the host's docker
    // postgres already has them applied. Log instead of throwing so a
    // packaged-mode-but-no-prisma build still boots into the UI.
    console.warn(
      `[desktop] prisma cli not found at ${prismaCli}; skipping migrate deploy`,
    );
    return;
  }
  await new Promise<void>((resolveFn, rejectFn) => {
    const child = spawn(
      process.execPath,
      [prismaCli, "migrate", "deploy", "--schema", join(dbModuleRoot, "prisma", "schema.prisma")],
      {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          DATABASE_URL: databaseUrl,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stdout?.on("data", (chunk) => process.stdout.write(`[migrate] ${chunk}`));
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(`[migrate] ${chunk}`);
    });
    child.once("exit", (code) => {
      if (code === 0) resolveFn();
      else rejectFn(new Error(`prisma migrate deploy exited code=${code}\n${stderr}`));
    });
    child.once("error", rejectFn);
  });
}

function createMainWindow(webUrl: string): BrowserWindow {
  // electron-builder embeds the icon set into the .app / .exe so macOS
  // and Windows pick up the dock / taskbar icon automatically. On Linux
  // (AppImage and dev launches) we still need to set BrowserWindow.icon
  // explicitly. Fall through to the default if the file is missing — a
  // missing icon is cosmetic, never fatal.
  const iconPath = app.isPackaged
    ? packagedResource("icon.png")
    : resolve(__dirname, "..", "build", "icon.png");
  const icon = existsSync(iconPath) ? iconPath : undefined;

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: "#0b0d10",
    icon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // No preload yet — the renderer is the same browser bundle
      // served on web; renderer↔main IPC + the contextBridge surface
      // get added when desktop-only features land (native file picker
      // for bulk uploads, OS notifications on long-running estimates,
      // tray icon). When that happens, write the preload as `.cts` so
      // it compiles to CommonJS — Electron's preload sandbox loader
      // doesn't support ESM today.
    },
  });

  // Open external links in the user's default browser instead of inside
  // the Electron window — keeps the app feeling native and avoids a
  // tab-of-tabs experience.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(webUrl)) {
      return { action: "allow" };
    }
    void shell.openExternal(url);
    return { action: "deny" };
  });

  void win.loadURL(webUrl);
  return win;
}

function buildAppMenu(): void {
  // Minimal native menu so common shortcuts (Cmd+W, Cmd+Q, View →
  // Reload, devtools) work as users expect. The default Electron menu
  // is dev-flavored; we trim it to estimator-appropriate items.
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "&File",
      submenu: [isMac ? { role: "close" as const } : { role: "quit" as const }],
    },
    {
      label: "&Edit",
      submenu: [
        { role: "undo" as const },
        { role: "redo" as const },
        { type: "separator" as const },
        { role: "cut" as const },
        { role: "copy" as const },
        { role: "paste" as const },
        { role: "selectAll" as const },
      ],
    },
    {
      label: "&View",
      submenu: [
        { role: "reload" as const },
        { role: "forceReload" as const },
        { role: "toggleDevTools" as const },
        { type: "separator" as const },
        { role: "resetZoom" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
        { type: "separator" as const },
        { role: "togglefullscreen" as const },
      ],
    },
    {
      label: "&Window",
      submenu: [
        { role: "minimize" as const },
        ...(isMac
          ? [{ role: "zoom" as const }, { type: "separator" as const }, { role: "front" as const }]
          : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Lifecycle ─────────────────────────────────────────────────────

async function start() {
  try {
    booted = app.isPackaged ? await bootPackaged() : await bootDev();
  } catch (err) {
    console.error("[desktop] fatal during boot:", err);
    dialog.showErrorBox(
      "Bidwright failed to start",
      err instanceof Error ? err.message : String(err),
    );
    app.quit();
    return;
  }

  buildAppMenu();
  mainWindow = createMainWindow(booted.webUrl);

  // Auto-update from GitHub Releases — packaged builds only, dev
  // launches skip the update check. Failures here are logged and
  // swallowed; an offline user shouldn't see a popup on every launch.
  if (app.isPackaged) {
    wireAutoUpdater().catch((err) => {
      console.warn("[desktop] auto-updater wiring failed:", err);
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && booted) {
      mainWindow = createMainWindow(booted.webUrl);
    }
  });
}

async function shutdown(): Promise<void> {
  console.log("[desktop] shutdown");
  if (booted?.webProcess) {
    booted.webProcess.kill("SIGINT");
  }
  if (booted?.apiProcess) {
    booted.apiProcess.kill("SIGINT");
  }
  if (booted?.pg) {
    await booted.pg.stop().catch(() => {});
  }
  booted = null;
}

app.whenReady().then(start);

app.on("window-all-closed", () => {
  // macOS keeps the app process alive even with zero windows so the
  // dock icon still works (standard convention). Other platforms quit.
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async (event) => {
  if (!booted) return;
  event.preventDefault();
  await shutdown();
  app.exit(0);
});

// Single-instance lock — opening a second copy focuses the existing
// window instead of starting another Postgres cluster on a different
// port. Without this the second instance silently spawns a duplicate
// embedded-postgres process and the data dir locks both out.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
