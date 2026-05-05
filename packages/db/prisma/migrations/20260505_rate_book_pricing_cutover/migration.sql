ALTER TABLE "WorksheetItem"
  ADD COLUMN IF NOT EXISTS "rateResolution" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "RateSchedule"
  ALTER COLUMN "category" SET DEFAULT '';

ALTER TABLE "RateScheduleItem"
  ADD COLUMN IF NOT EXISTS "resourceId" TEXT;

ALTER TABLE "RateScheduleItem"
  DROP CONSTRAINT IF EXISTS "RateScheduleItem_catalogItemId_fkey";

ALTER TABLE "RateScheduleItem"
  ALTER COLUMN "catalogItemId" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RateScheduleItem_catalogItemId_fkey'
  ) THEN
    ALTER TABLE "RateScheduleItem"
      ADD CONSTRAINT "RateScheduleItem_catalogItemId_fkey"
      FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RateScheduleItem_resourceId_fkey'
  ) THEN
    ALTER TABLE "RateScheduleItem"
      ADD CONSTRAINT "RateScheduleItem_resourceId_fkey"
      FOREIGN KEY ("resourceId") REFERENCES "ResourceCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "RateScheduleItem_resourceId_idx"
  ON "RateScheduleItem"("resourceId");

CREATE TABLE IF NOT EXISTS "RateBookAssignment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "rateScheduleId" TEXT NOT NULL,
  "customerId" TEXT,
  "projectId" TEXT,
  "category" TEXT NOT NULL DEFAULT '',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "effectiveDate" TEXT,
  "expiryDate" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RateBookAssignment_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RateBookAssignment_organizationId_fkey'
  ) THEN
    ALTER TABLE "RateBookAssignment"
      ADD CONSTRAINT "RateBookAssignment_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RateBookAssignment_rateScheduleId_fkey'
  ) THEN
    ALTER TABLE "RateBookAssignment"
      ADD CONSTRAINT "RateBookAssignment_rateScheduleId_fkey"
      FOREIGN KEY ("rateScheduleId") REFERENCES "RateSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RateBookAssignment_customerId_fkey'
  ) THEN
    ALTER TABLE "RateBookAssignment"
      ADD CONSTRAINT "RateBookAssignment_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RateBookAssignment_projectId_fkey'
  ) THEN
    ALTER TABLE "RateBookAssignment"
      ADD CONSTRAINT "RateBookAssignment_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "RateBookAssignment_organizationId_idx"
  ON "RateBookAssignment"("organizationId");
CREATE INDEX IF NOT EXISTS "RateBookAssignment_rateScheduleId_idx"
  ON "RateBookAssignment"("rateScheduleId");
CREATE INDEX IF NOT EXISTS "RateBookAssignment_customerId_idx"
  ON "RateBookAssignment"("customerId");
CREATE INDEX IF NOT EXISTS "RateBookAssignment_projectId_idx"
  ON "RateBookAssignment"("projectId");
CREATE INDEX IF NOT EXISTS "RateBookAssignment_organizationId_customerId_category_idx"
  ON "RateBookAssignment"("organizationId", "customerId", "category");
CREATE INDEX IF NOT EXISTS "RateBookAssignment_organizationId_projectId_category_idx"
  ON "RateBookAssignment"("organizationId", "projectId", "category");
