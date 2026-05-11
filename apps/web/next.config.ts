import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  // Next's tracer (@vercel/nft) misses several of next's runtime peer
  // deps when packaging from a pnpm monorepo — @swc/helpers' proxy
  // folders, @next/env, etc — because the .pnpm symlink layout
  // confuses its file walk. The packaged Electron sidecar then crashes
  // on launch with "Cannot find module ...". Pull the whole tree of
  // next-runtime peers in explicitly via both the pnpm-virtual-store
  // path and the apps-relative resolved path.
  outputFileTracingIncludes: {
    "/*": [
      "../../node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/**/*",
      "../../node_modules/.pnpm/@next+env@*/node_modules/@next/env/**/*",
      "../../node_modules/.pnpm/styled-jsx@*/node_modules/styled-jsx/**/*",
      "../../node_modules/.pnpm/client-only@*/node_modules/client-only/**/*",
      "../../node_modules/.pnpm/server-only@*/node_modules/server-only/**/*",
      "../../node_modules/.pnpm/busboy@*/node_modules/busboy/**/*",
      "../../node_modules/.pnpm/caniuse-lite@*/node_modules/caniuse-lite/**/*",
      "./node_modules/@swc/helpers/**/*",
      "./node_modules/@next/env/**/*",
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "motion"],
  },
};

export default nextConfig;
