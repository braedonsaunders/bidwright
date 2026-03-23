-- Add template/library support fields to Catalog (mirrors Dataset pattern)
ALTER TABLE "Catalog" ALTER COLUMN "organizationId" DROP NOT NULL;
ALTER TABLE "Catalog" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "Catalog" ADD COLUMN "sourceDescription" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Catalog" ADD COLUMN "isTemplate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Catalog" ADD COLUMN "sourceTemplateId" TEXT;
ALTER TABLE "Catalog" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Catalog" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Add order and timestamps to CatalogItem
ALTER TABLE "CatalogItem" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CatalogItem" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "CatalogItem" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Index for template lookups
CREATE INDEX "Catalog_isTemplate_idx" ON "Catalog"("isTemplate");
