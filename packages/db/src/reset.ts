/**
 * Reset the database to a clean state.
 * Truncates all tables but keeps the schema intact.
 * After running this, the next app launch will show the setup wizard.
 *
 * Usage: pnpm --filter @bidwright/db db:reset
 */
import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  console.log("Resetting database...\n");

  // Get all table names from the public schema
  const tables: Array<{ tablename: string }> = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
  `;

  // Truncate all tables with CASCADE
  for (const { tablename } of tables) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE`);
      console.log(`  Truncated: ${tablename}`);
    } catch (err) {
      console.log(`  Skipped: ${tablename} (${err instanceof Error ? err.message : "error"})`);
    }
  }

  await prisma.$disconnect();
  console.log("\nDatabase reset complete. Launch the app to run the setup wizard.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
