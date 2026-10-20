-- Organisation piping specification library for the embedded Spoolyard editor.
--
-- Additive only. One row per (organization, Spoolyard spec id); the full spec
-- lives in "data" and the summary columns are derived from it on write.

-- CreateTable
CREATE TABLE IF NOT EXISTS "PipingSpecLibraryEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "specId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "material" TEXT NOT NULL DEFAULT '',
    "service" TEXT NOT NULL DEFAULT '',
    "rating" TEXT NOT NULL DEFAULT '',
    "revision" TEXT NOT NULL DEFAULT '',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipingSpecLibraryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PipingSpecLibraryEntry_organizationId_specId_key"
  ON "PipingSpecLibraryEntry"("organizationId", "specId");

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PipingSpecLibraryEntry_organizationId_fkey') THEN
    ALTER TABLE "PipingSpecLibraryEntry"
      ADD CONSTRAINT "PipingSpecLibraryEntry_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$migration$;
