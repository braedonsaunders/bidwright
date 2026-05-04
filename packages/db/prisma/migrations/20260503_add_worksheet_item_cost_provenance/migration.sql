ALTER TABLE "WorksheetItem"
  ADD COLUMN "costResourceId" TEXT,
  ADD COLUMN "effectiveCostId" TEXT,
  ADD COLUMN "laborUnitId" TEXT,
  ADD COLUMN "resourceComposition" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "sourceEvidence" JSONB NOT NULL DEFAULT '{}';

CREATE INDEX "WorksheetItem_costResourceId_idx" ON "WorksheetItem"("costResourceId");
CREATE INDEX "WorksheetItem_effectiveCostId_idx" ON "WorksheetItem"("effectiveCostId");
CREATE INDEX "WorksheetItem_laborUnitId_idx" ON "WorksheetItem"("laborUnitId");

ALTER TABLE "WorksheetItem"
  ADD CONSTRAINT "WorksheetItem_costResourceId_fkey"
  FOREIGN KEY ("costResourceId") REFERENCES "ResourceCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorksheetItem"
  ADD CONSTRAINT "WorksheetItem_effectiveCostId_fkey"
  FOREIGN KEY ("effectiveCostId") REFERENCES "EffectiveCost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorksheetItem"
  ADD CONSTRAINT "WorksheetItem_laborUnitId_fkey"
  FOREIGN KEY ("laborUnitId") REFERENCES "LaborUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
