-- Assemblies: reusable kits of catalog items, rate-schedule items, and nested sub-assemblies,
-- with named parameters that scale component quantities at expansion time.

CREATE TABLE "Assembly" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT,
  "name"             TEXT NOT NULL,
  "code"             TEXT NOT NULL DEFAULT '',
  "description"      TEXT NOT NULL DEFAULT '',
  "category"         TEXT NOT NULL DEFAULT '',
  "unit"             TEXT NOT NULL DEFAULT 'EA',
  "isTemplate"       BOOLEAN NOT NULL DEFAULT false,
  "sourceTemplateId" TEXT,
  "metadata"         JSONB NOT NULL DEFAULT '{}',
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Assembly_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssemblyParameter" (
  "id"           TEXT NOT NULL,
  "assemblyId"   TEXT NOT NULL,
  "key"          TEXT NOT NULL,
  "label"        TEXT NOT NULL DEFAULT '',
  "description"  TEXT NOT NULL DEFAULT '',
  "paramType"    TEXT NOT NULL DEFAULT 'number',
  "defaultValue" TEXT NOT NULL DEFAULT '0',
  "unit"         TEXT NOT NULL DEFAULT '',
  "sortOrder"    INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "AssemblyParameter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssemblyComponent" (
  "id"                 TEXT NOT NULL,
  "assemblyId"         TEXT NOT NULL,
  "componentType"      TEXT NOT NULL,
  "catalogItemId"      TEXT,
  "rateScheduleItemId" TEXT,
  "subAssemblyId"      TEXT,
  "quantityExpr"       TEXT NOT NULL DEFAULT '1',
  "description"        TEXT NOT NULL DEFAULT '',
  "category"           TEXT NOT NULL DEFAULT '',
  "uomOverride"        TEXT,
  "costOverride"       DOUBLE PRECISION,
  "markupOverride"     DOUBLE PRECISION,
  "parameterBindings"  JSONB NOT NULL DEFAULT '{}',
  "notes"              TEXT NOT NULL DEFAULT '',
  "sortOrder"          INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "AssemblyComponent_pkey" PRIMARY KEY ("id")
);

-- Track which assembly produced a worksheet item snapshot.
ALTER TABLE "WorksheetItem" ADD COLUMN "sourceAssemblyId" TEXT;
ALTER TABLE "WorksheetItem" ADD COLUMN "assemblyInstanceId" TEXT;

CREATE INDEX "Assembly_organizationId_idx" ON "Assembly"("organizationId");
CREATE INDEX "Assembly_isTemplate_idx" ON "Assembly"("isTemplate");

CREATE UNIQUE INDEX "AssemblyParameter_assemblyId_key_key" ON "AssemblyParameter"("assemblyId", "key");
CREATE INDEX "AssemblyParameter_assemblyId_idx" ON "AssemblyParameter"("assemblyId");

CREATE INDEX "AssemblyComponent_assemblyId_idx" ON "AssemblyComponent"("assemblyId");
CREATE INDEX "AssemblyComponent_catalogItemId_idx" ON "AssemblyComponent"("catalogItemId");
CREATE INDEX "AssemblyComponent_rateScheduleItemId_idx" ON "AssemblyComponent"("rateScheduleItemId");
CREATE INDEX "AssemblyComponent_subAssemblyId_idx" ON "AssemblyComponent"("subAssemblyId");

CREATE INDEX "WorksheetItem_sourceAssemblyId_idx" ON "WorksheetItem"("sourceAssemblyId");
CREATE INDEX "WorksheetItem_assemblyInstanceId_idx" ON "WorksheetItem"("assemblyInstanceId");

ALTER TABLE "Assembly"
  ADD CONSTRAINT "Assembly_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssemblyParameter"
  ADD CONSTRAINT "AssemblyParameter_assemblyId_fkey"
  FOREIGN KEY ("assemblyId") REFERENCES "Assembly"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssemblyComponent"
  ADD CONSTRAINT "AssemblyComponent_assemblyId_fkey"
  FOREIGN KEY ("assemblyId") REFERENCES "Assembly"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssemblyComponent"
  ADD CONSTRAINT "AssemblyComponent_catalogItemId_fkey"
  FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssemblyComponent"
  ADD CONSTRAINT "AssemblyComponent_rateScheduleItemId_fkey"
  FOREIGN KEY ("rateScheduleItemId") REFERENCES "RateScheduleItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssemblyComponent"
  ADD CONSTRAINT "AssemblyComponent_subAssemblyId_fkey"
  FOREIGN KEY ("subAssemblyId") REFERENCES "Assembly"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorksheetItem"
  ADD CONSTRAINT "WorksheetItem_sourceAssemblyId_fkey"
  FOREIGN KEY ("sourceAssemblyId") REFERENCES "Assembly"("id") ON DELETE SET NULL ON UPDATE CASCADE;
