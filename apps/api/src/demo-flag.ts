/**
 * The public-demo predicate on its own, with no Prisma or seeding imports.
 *
 * `demo-mode.ts` re-exports this and adds the identity/seed helpers. Startup
 * code (bootstrap, agent-host) needs the flag before — and sometimes without —
 * any database, so it imports from here.
 */
export function isApiDemoMode(): boolean {
  return process.env.BIDWRIGHT_DEMO_MODE === "1" || process.env.BIDWRIGHT_PUBLIC_DEMO === "1";
}
