-- First-class labor unit libraries. Labor units represent productivity
-- standards: hours required per output unit, priced later through revision
-- rate-book items.

CREATE TABLE "LaborUnitLibrary" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "cabinetId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "provider" TEXT NOT NULL DEFAULT '',
  "discipline" TEXT NOT NULL DEFAULT '',
  "source" TEXT NOT NULL DEFAULT 'manual',
  "sourceDescription" TEXT NOT NULL DEFAULT '',
  "sourceDatasetId" TEXT,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isTemplate" BOOLEAN NOT NULL DEFAULT false,
  "sourceTemplateId" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LaborUnitLibrary_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LaborUnit" (
  "id" TEXT NOT NULL,
  "libraryId" TEXT NOT NULL,
  "catalogItemId" TEXT,
  "code" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "discipline" TEXT NOT NULL DEFAULT '',
  "category" TEXT NOT NULL DEFAULT '',
  "className" TEXT NOT NULL DEFAULT '',
  "subClassName" TEXT NOT NULL DEFAULT '',
  "outputUom" TEXT NOT NULL DEFAULT 'EA',
  "hoursNormal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "hoursDifficult" DOUBLE PRECISION,
  "hoursVeryDifficult" DOUBLE PRECISION,
  "defaultDifficulty" TEXT NOT NULL DEFAULT 'normal',
  "entityCategoryType" TEXT NOT NULL DEFAULT 'Labour',
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sourceRef" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LaborUnit_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LaborUnitLibrary"
  ADD CONSTRAINT "LaborUnitLibrary_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LaborUnitLibrary"
  ADD CONSTRAINT "LaborUnitLibrary_cabinetId_fkey"
  FOREIGN KEY ("cabinetId") REFERENCES "KnowledgeLibraryCabinet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LaborUnit"
  ADD CONSTRAINT "LaborUnit_libraryId_fkey"
  FOREIGN KEY ("libraryId") REFERENCES "LaborUnitLibrary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LaborUnit"
  ADD CONSTRAINT "LaborUnit_catalogItemId_fkey"
  FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssemblyComponent"
  ADD COLUMN "laborUnitId" TEXT,
  ADD COLUMN "laborDifficulty" TEXT NOT NULL DEFAULT 'normal';

ALTER TABLE "AssemblyComponent"
  ADD CONSTRAINT "AssemblyComponent_laborUnitId_fkey"
  FOREIGN KEY ("laborUnitId") REFERENCES "LaborUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "LaborUnitLibrary_organizationId_idx" ON "LaborUnitLibrary"("organizationId");
CREATE INDEX "LaborUnitLibrary_cabinetId_idx" ON "LaborUnitLibrary"("cabinetId");
CREATE INDEX "LaborUnitLibrary_isTemplate_idx" ON "LaborUnitLibrary"("isTemplate");
CREATE INDEX "LaborUnitLibrary_provider_idx" ON "LaborUnitLibrary"("provider");

CREATE INDEX "LaborUnit_libraryId_idx" ON "LaborUnit"("libraryId");
CREATE INDEX "LaborUnit_catalogItemId_idx" ON "LaborUnit"("catalogItemId");
CREATE INDEX "LaborUnit_category_idx" ON "LaborUnit"("category");
CREATE INDEX "LaborUnit_className_idx" ON "LaborUnit"("className");
CREATE INDEX "LaborUnit_subClassName_idx" ON "LaborUnit"("subClassName");
CREATE INDEX "LaborUnit_entityCategoryType_idx" ON "LaborUnit"("entityCategoryType");

CREATE INDEX "AssemblyComponent_laborUnitId_idx" ON "AssemblyComponent"("laborUnitId");
