// Two reasons we don't import directly from "@prisma/client":
//
// 1. Prisma 6's CJS bundle does `module.exports = { ...require(...) }`,
//    which Node ESM's cjs-module-lexer can't statically resolve into
//    named exports. Pure Node ESM (the packaged Electron api child)
//    rejects `import { PrismaClient } from "@prisma/client"`.
// 2. The default `@prisma/client` entry forwards to `.prisma/client`,
//    a dot-prefixed peer in node_modules that doesn't survive pnpm
//    symlink-following during electron-builder packaging.
//
// The schema's generator points at packages/db/generated/prisma-client,
// which ships naturally with the @bidwright/db workspace dep. Default-
// import the value, type-only-import the type so generic shape stays
// intact.
import PrismaPkg from "../generated/prisma-client/default.js";
import type { PrismaClient as PrismaClientCtor } from "../generated/prisma-client/default.js";
const PrismaClient = PrismaPkg.PrismaClient as typeof PrismaClientCtor;
type PrismaClient = PrismaClientCtor;

import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Return a client that will fail on first query with a clear message
    return new PrismaClient();
  }

  const pool = new pg.Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  } as any);
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export { PrismaClient };
export type { Prisma } from "../generated/prisma-client/default.js";
