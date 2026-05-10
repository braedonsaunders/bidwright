-- DwgEntityLink: direct association between a CAD entity (DXF/DWG) and a worksheet line item.

CREATE TABLE "DwgEntityLink" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL DEFAULT '',
  "layer" TEXT NOT NULL DEFAULT '',
  "worksheetItemId" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "derivedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "selection" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DwgEntityLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DwgEntityLink_documentId_entityId_worksheetItemId_key"
  ON "DwgEntityLink"("documentId", "entityId", "worksheetItemId");
CREATE INDEX "DwgEntityLink_projectId_idx" ON "DwgEntityLink"("projectId");
CREATE INDEX "DwgEntityLink_documentId_idx" ON "DwgEntityLink"("documentId");
CREATE INDEX "DwgEntityLink_entityId_idx" ON "DwgEntityLink"("entityId");
CREATE INDEX "DwgEntityLink_worksheetItemId_idx" ON "DwgEntityLink"("worksheetItemId");

ALTER TABLE "DwgEntityLink"
ADD CONSTRAINT "DwgEntityLink_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DwgEntityLink"
ADD CONSTRAINT "DwgEntityLink_worksheetItemId_fkey"
FOREIGN KEY ("worksheetItemId") REFERENCES "WorksheetItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
