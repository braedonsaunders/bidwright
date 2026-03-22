export type PrismaClientLike = {
  [key: string]: unknown;
  $disconnect?: () => Promise<void>;
};

declare global {
  // eslint-disable-next-line no-var
  var __bidwrightPrismaPromise: Promise<PrismaClientLike> | undefined;
}

export async function getPrismaClient(): Promise<PrismaClientLike> {
  if (!globalThis.__bidwrightPrismaPromise) {
    globalThis.__bidwrightPrismaPromise = import("@prisma/client").then((module) => {
      const PrismaClientCtor = (module as { PrismaClient?: new () => PrismaClientLike }).PrismaClient;

      if (!PrismaClientCtor) {
        throw new Error(
          "PrismaClient is unavailable. Run `pnpm approve-builds` and `pnpm db:generate` to enable Prisma locally."
        );
      }

      return new PrismaClientCtor();
    });
  }

  return globalThis.__bidwrightPrismaPromise;
}
