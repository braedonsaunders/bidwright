ALTER TABLE "EffectiveCost" DROP CONSTRAINT IF EXISTS "EffectiveCost_resourceId_fkey";

ALTER TABLE "EffectiveCost" ALTER COLUMN "resourceId" DROP NOT NULL;

ALTER TABLE "EffectiveCost"
  ADD CONSTRAINT "EffectiveCost_resourceId_fkey"
  FOREIGN KEY ("resourceId") REFERENCES "ResourceCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
