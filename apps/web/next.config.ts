import type { NextConfig } from "next";
import path from "node:path";

const isVercel = process.env.VERCEL === "1";

const nextConfig: NextConfig = {
  output: isVercel ? undefined : "standalone",
  // Lock the standalone output's trace root to the monorepo root so paths
  // stay predictable across local builds (where a parent worktree above
  // confuses Next's auto-detection) and CI runs (single checkout).
  // process.cwd() === apps/web because next runs from there.
  outputFileTracingRoot: isVercel ? undefined : path.resolve(process.cwd(), "../.."),
  devIndicators: false,
  // Next's tracer (@vercel/nft) misses runtime peer deps from a pnpm
  // monorepo — its file walk doesn't follow the `.pnpm/` virtual store
  // reliably, and Windows installer extraction doesn't preserve the
  // symlinks that pnpm uses to bridge that store to top-level
  // node_modules. Result: Next dist code does `require("react")` and
  // Node's walk from `apps/web/node_modules/next/dist/...` fails to
  // find it because react only lives at `.pnpm/react@.../node_modules/`.
  //
  // Workaround: explicitly include every direct dep at the
  // apps/web/node_modules/<dep> path AND the @next/@swc namespaces.
  // Wildcard is safe — Next still tree-shakes used code, this just
  // tells the tracer "don't drop these files."
  outputFileTracingIncludes: isVercel ? undefined : {
    // With node-linker=hoisted, all deps live in the monorepo root
    // node_modules. Pull each top-level dep whole — Node's require walk
    // from next/dist needs to find sibling files (esm/*.js, _/<name>/,
    // etc) that nft otherwise misses because nothing in the trace graph
    // explicitly requires them.
    "/*": [
      "../../node_modules/*/**/*",
      "../../node_modules/@*/*/**/*",
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "motion"],
  },
};

export default nextConfig;
