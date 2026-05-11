import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  // @swc/helpers 0.5.17+ exposes its helpers via package.json proxy
  // directories under `_/<name>/package.json` that re-export from
  // `cjs/_<name>.cjs`. @vercel/nft (Next's tracer) follows the cjs/
  // requires but doesn't pull the proxy folders along, so the packaged
  // app crashes with "Cannot find module '@swc/helpers/_/<name>'" on
  // launch. Explicitly include the proxy tree.
  outputFileTracingIncludes: {
    "/*": [
      "../../node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/**/*",
      "./node_modules/@swc/helpers/**/*",
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "motion"],
  },
};

export default nextConfig;
