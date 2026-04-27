-- Track each insertion of an assembly into a worksheet, so we can re-sync,
-- scale, or remove the whole group later. WorksheetItem.assemblyInstanceId
-- already exists as a plain string column from the previous migration; this
-- migration upgrades it to a real FK pointing at AssemblyInstance.

CREATE TABLE "AssemblyInstance" (
  "id"              TEXT NOT NULL,
  "worksheetId"     TEXT NOT NULL,
  "assemblyId"      TEXT,
  "phaseId"         TEXT,
  "quantity"        DOUBLE PRECISION NOT NULL DEFAULT 1,
  "parameterValues" JSONB NOT NULL DEFAULT '{}',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AssemblyInstance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssemblyInstance_worksheetId_idx" ON "AssemblyInstance"("worksheetId");
CREATE INDEX "AssemblyInstance_assemblyId_idx"  ON "AssemblyInstance"("assemblyId");

ALTER TABLE "AssemblyInstance"
  ADD CONSTRAINT "AssemblyInstance_worksheetId_fkey"
  FOREIGN KEY ("worksheetId") REFERENCES "Worksheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssemblyInstance"
  ADD CONSTRAINT "AssemblyInstance_assemblyId_fkey"
  FOREIGN KEY ("assemblyId") REFERENCES "Assembly"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The previous WorksheetItem.assemblyInstanceId values were not FK-backed, so
-- back-fill an instance row for any existing groups before adding the FK.
INSERT INTO "AssemblyInstance" ("id", "worksheetId", "assemblyId", "phaseId", "quantity", "parameterValues", "updatedAt")
SELECT
  wi."assemblyInstanceId" AS "id",
  wi."worksheetId" AS "worksheetId",
  MIN(wi."sourceAssemblyId") AS "assemblyId",
  MIN(wi."phaseId") AS "phaseId",
  1 AS "quantity",
  '{}'::jsonb AS "parameterValues",
  CURRENT_TIMESTAMP AS "updatedAt"
FROM "WorksheetItem" wi
WHERE wi."assemblyInstanceId" IS NOT NULL
GROUP BY wi."assemblyInstanceId", wi."worksheetId";

ALTER TABLE "WorksheetItem"
  ADD CONSTRAINT "WorksheetItem_assemblyInstanceId_fkey"
  FOREIGN KEY ("assemblyInstanceId") REFERENCES "AssemblyInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
