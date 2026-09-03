import { execSync } from "node:child_process";

/**
 * PowerShell that force-stops any process whose command line mentions
 * `dataDir`. Used to clear leftover embedded-postgres / node sidecars
 * that survived a previous Windows session and lock the data directory.
 */
export function windowsStopProcessesUsingPathCommand(dataDir: string): string {
  const escaped = dataDir.replace(/'/g, "''");
  return [
    "Get-CimInstance Win32_Process",
    `| Where-Object { $_.CommandLine -like '*${escaped}*' }`,
    "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
  ].join(" ");
}

export function killProcessesUsingPath(dataDir: string): void {
  if (process.platform !== "win32" || !dataDir) return;
  try {
    execSync(`powershell -NoProfile -Command "${windowsStopProcessesUsingPathCommand(dataDir)}"`, {
      stdio: "ignore",
      windowsHide: true,
      timeout: 15_000,
    });
  } catch {
    /* ignore — process may already be gone */
  }
}
