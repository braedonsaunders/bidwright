/**
 * Tiny helpers used by the Electron main process.
 *
 * We avoid pulling in a npm dep for these — both are 20 lines and
 * having them here keeps the desktop bundle's runtime dependency
 * surface tighter, which matters for security review of an installer
 * that ends up on estimator workstations.
 */

import { createServer } from "node:net";

/**
 * Ask the OS for an unused TCP port. Returns the port number; the test
 * server is closed immediately so the caller can bind it themselves.
 * There's a tiny race window between close+bind, but it's acceptable
 * for a single-user desktop app where the only thing competing for
 * ports is Bidwright itself.
 */
export function getAvailablePort(): Promise<number> {
  return new Promise<number>((resolveFn, rejectFn) => {
    const server = createServer();
    server.unref();
    server.on("error", rejectFn);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        server.close(() => resolveFn(port));
      } else {
        rejectFn(new Error("getAvailablePort: failed to read bound port"));
      }
    });
  });
}

/**
 * Poll an HTTP endpoint until it answers with any non-5xx response (or
 * the timeout fires). Used to gate window-creation on the api+web
 * actually being healthy — opening the BrowserWindow before Next is
 * ready shows a "site can't be reached" page that confuses end users
 * into force-quitting before the boot finishes.
 */
export async function waitForHttpReady(
  url: string,
  opts: { timeoutMs: number; intervalMs?: number } = { timeoutMs: 30_000 },
): Promise<void> {
  const interval = opts.intervalMs ?? 250;
  const deadline = Date.now() + opts.timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        // Don't follow redirects — Next.js often 308s on GET / in dev
        // mode, which is enough signal that the server is up.
        redirect: "manual",
      });
      if (response.status < 500) return;
      lastError = new Error(`status ${response.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(
    `waitForHttpReady: ${url} not ready in ${opts.timeoutMs}ms (last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    })`,
  );
}
