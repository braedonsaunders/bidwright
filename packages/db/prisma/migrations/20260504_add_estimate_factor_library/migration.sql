CREATE TABLE "EstimateFactorLibraryEntry" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT NOT NULL DEFAULT '',
  "code" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "category" TEXT NOT NULL DEFAULT 'Productivity',
  "impact" TEXT NOT NULL DEFAULT 'labor_hours',
  "value" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "appliesTo" TEXT NOT NULL DEFAULT 'Labour',
  "scope" JSONB NOT NULL DEFAULT '{}',
  "confidence" TEXT NOT NULL DEFAULT 'medium',
  "sourceType" TEXT NOT NULL DEFAULT 'custom',
  "sourceId" TEXT,
  "sourceRef" JSONB NOT NULL DEFAULT '{}',
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EstimateFactorLibraryEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EstimateFactorLibraryEntry_organizationId_idx" ON "EstimateFactorLibraryEntry"("organizationId");
CREATE INDEX "EstimateFactorLibraryEntry_sourceType_idx" ON "EstimateFactorLibraryEntry"("sourceType");

ALTER TABLE "EstimateFactorLibraryEntry"
  ADD CONSTRAINT "EstimateFactorLibraryEntry_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
