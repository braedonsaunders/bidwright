-- AlterTable
ALTER TABLE "Project" ADD COLUMN "isStandalone" BOOLEAN NOT NULL DEFAULT true;

-- Backfill: any project that already has 2+ quotes is a real container project.
-- Single-quote and zero-quote projects stay standalone (the new default), so
-- they render as flat rows in the quotes list until a user promotes them.
UPDATE "Project"
SET "isStandalone" = false
WHERE "id" IN (
  SELECT "projectId"
  FROM "Quote"
  GROUP BY "projectId"
  HAVING COUNT(*) >= 2
);
