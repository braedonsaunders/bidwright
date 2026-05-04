ALTER TABLE "AssemblyComponent"
  ADD COLUMN "costResourceId" TEXT,
  ADD COLUMN "effectiveCostId" TEXT;

CREATE INDEX "AssemblyComponent_costResourceId_idx" ON "AssemblyComponent"("costResourceId");
CREATE INDEX "AssemblyComponent_effectiveCostId_idx" ON "AssemblyComponent"("effectiveCostId");

ALTER TABLE "AssemblyComponent"
  ADD CONSTRAINT "AssemblyComponent_costResourceId_fkey"
  FOREIGN KEY ("costResourceId") REFERENCES "ResourceCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssemblyComponent"
  ADD CONSTRAINT "AssemblyComponent_effectiveCostId_fkey"
  FOREIGN KEY ("effectiveCostId") REFERENCES "EffectiveCost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
