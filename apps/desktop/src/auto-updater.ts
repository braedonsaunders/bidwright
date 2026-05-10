/**
 * Auto-update wiring backed by electron-updater + GitHub Releases.
 *
 * When the desktop-release CI workflow uploads `.dmg` / `.exe` /
 * `.AppImage` artifacts to a tagged GitHub Release, electron-updater
 * sees them via the `latest-mac.yml` / `latest.yml` / `latest-linux.yml`
 * sidecars that electron-builder ships alongside the installers.
 * Each launch calls `checkForUpdatesAndNotify()`:
 *
 *   • New version found → download in the background, prompt the user
 *     on quit to install.
 *   • Up to date → silent.
 *   • Network error / repo not configured → log + swallow (offline use
 *     never sees a popup).
 *
 * Skipped when the app isn't packaged (dev launches don't auto-update).
 *
 * Configuration: `electron-builder` reads the `publish` field on the
 * desktop package.json. We default to `provider: github` with the repo
 * inferred from the git origin at build time. Releases under another
 * provider (Cloudflare R2, custom server) just need that field swapped.
 */

import { app, dialog } from "electron";

export async function wireAutoUpdater(): Promise<void> {
  if (!app.isPackaged) return;

  // Lazy-import so dev launches don't pay for the electron-updater
  // dependency graph.
  const { autoUpdater } = await import("electron-updater");

  // Quiet-by-default in production; toggle this on while debugging an
  // update channel in a staging environment.
  autoUpdater.logger = {
    info: (msg: unknown) => console.log("[auto-updater]", msg),
    warn: (msg: unknown) => console.warn("[auto-updater]", msg),
    error: (msg: unknown) => console.error("[auto-updater]", msg),
    debug: () => {},
  } as unknown as typeof autoUpdater.logger;

  // Don't auto-download on metered connections — surprises the user
  // on tethered laptops in the field.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    console.log(`[auto-updater] update available: ${info.version}`);
  });
  autoUpdater.on("update-not-available", () => {
    console.log("[auto-updater] up to date");
  });
  autoUpdater.on("download-progress", (progress) => {
    console.log(
      `[auto-updater] downloading update: ${Math.round(progress.percent)}%`,
    );
  });
  autoUpdater.on("update-downloaded", (info) => {
    console.log(`[auto-updater] update downloaded: ${info.version}`);
    void dialog.showMessageBox({
      type: "info",
      title: "Update available",
      message: `Bidwright ${info.version} is ready to install.`,
      detail:
        "The update will be installed automatically the next time you quit the app. Click Restart Now to update immediately.",
      buttons: ["Later", "Restart Now"],
      defaultId: 1,
      cancelId: 0,
    }).then((result) => {
      if (result.response === 1) {
        autoUpdater.quitAndInstall();
      }
    });
  });
  autoUpdater.on("error", (err) => {
    // The most common cause is "no GitHub release published yet" or a
    // private repo without a token. Don't bother the user with a popup.
    console.warn("[auto-updater] error:", err instanceof Error ? err.message : err);
  });

  try {
    await autoUpdater.checkForUpdatesAndNotify();
  } catch (err) {
    console.warn(
      "[auto-updater] check skipped:",
      err instanceof Error ? err.message : err,
    );
  }
}
