import { runStartupBootstrap } from "./bootstrap.js";
import { buildServer } from "./server.js";
import { ensureEgressProxyForMultitenant } from "./services/egress-proxy-bootstrap.js";
import { assertAgentRuntimeHostReady } from "./services/agent-host/index.js";

const port = Number(process.env.API_PORT ?? "4001");

async function main() {
  // Apply pending Prisma migrations and ensure the integrations encryption
  // key exists before any request can hit a route. Both are idempotent.
  await runStartupBootstrap();

  // Server deployments fail closed before listening if the AppKit process
  // sandbox cannot actually create its namespaces and mounts.
  await assertAgentRuntimeHostReady();

  // In multi-tenant server mode, start the egress allowlist proxy that
  // bwrap-isolated CLI sessions route LLM API + MCP traffic through. No-op
  // in desktop / single-tenant mode.
  await ensureEgressProxyForMultitenant({
    apiBaseUrl: `http://localhost:${port}`,
  });

  const server = buildServer();
  await server.listen({ host: "0.0.0.0", port });
  console.log(`Bidwright API listening on http://localhost:${port}`);
}

main().catch((error) => {
  console.error("[startup] fatal:", error);
  process.exit(1);
});
