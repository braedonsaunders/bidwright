// Prisma's CJS bundle uses `module.exports = { ...require(...) }`, which
// Node ESM's cjs-module-lexer can't statically resolve into named exports.
// Pure Node ESM (the packaged Electron api child) rejects
// `import { PrismaClient } from "@prisma/client"`. Take the value through
// default-import and the types through a separate type-only import — both
// tsx (dev) and Turbopack handle this identically.
import PrismaPkg from "@prisma/client";
import type { PrismaClient as PrismaClientCtor } from "@prisma/client";
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
export type { Prisma } from "@prisma/client";
