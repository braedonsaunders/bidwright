-- Promote cost intelligence vendors and vendor products to first-party records
-- so observed costs and cost basis rows can link to both the internal cost item
-- and the vendor-specific product/SKU that produced the evidence.

CREATE TABLE "CostVendor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL DEFAULT '',
    "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "website" TEXT NOT NULL DEFAULT '',
    "contactInfo" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostVendor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CostVendorProduct" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "resourceId" TEXT,
    "sku" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "defaultUom" TEXT NOT NULL DEFAULT 'EA',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostVendorProduct_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PriceObservation" ADD COLUMN "vendorId" TEXT;
ALTER TABLE "PriceObservation" ADD COLUMN "vendorProductId" TEXT;

ALTER TABLE "EffectiveCost" ADD COLUMN "vendorId" TEXT;
ALTER TABLE "EffectiveCost" ADD COLUMN "vendorProductId" TEXT;

CREATE UNIQUE INDEX "CostVendor_organizationId_normalizedName_key" ON "CostVendor"("organizationId", "normalizedName");
CREATE INDEX "CostVendor_organizationId_idx" ON "CostVendor"("organizationId");
CREATE INDEX "CostVendor_organizationId_name_idx" ON "CostVendor"("organizationId", "name");

CREATE UNIQUE INDEX "CostVendorProduct_vendorId_sku_normalizedName_defaultUom_key" ON "CostVendorProduct"("vendorId", "sku", "normalizedName", "defaultUom");
CREATE INDEX "CostVendorProduct_organizationId_idx" ON "CostVendorProduct"("organizationId");
CREATE INDEX "CostVendorProduct_vendorId_idx" ON "CostVendorProduct"("vendorId");
CREATE INDEX "CostVendorProduct_resourceId_idx" ON "CostVendorProduct"("resourceId");
CREATE INDEX "CostVendorProduct_organizationId_sku_idx" ON "CostVendorProduct"("organizationId", "sku");

CREATE INDEX "PriceObservation_vendorId_idx" ON "PriceObservation"("vendorId");
CREATE INDEX "PriceObservation_vendorProductId_idx" ON "PriceObservation"("vendorProductId");

CREATE INDEX "EffectiveCost_vendorId_idx" ON "EffectiveCost"("vendorId");
CREATE INDEX "EffectiveCost_vendorProductId_idx" ON "EffectiveCost"("vendorProductId");

ALTER TABLE "CostVendor"
  ADD CONSTRAINT "CostVendor_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CostVendorProduct"
  ADD CONSTRAINT "CostVendorProduct_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CostVendorProduct"
  ADD CONSTRAINT "CostVendorProduct_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "CostVendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CostVendorProduct"
  ADD CONSTRAINT "CostVendorProduct_resourceId_fkey"
  FOREIGN KEY ("resourceId") REFERENCES "ResourceCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PriceObservation"
  ADD CONSTRAINT "PriceObservation_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "CostVendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PriceObservation"
  ADD CONSTRAINT "PriceObservation_vendorProductId_fkey"
  FOREIGN KEY ("vendorProductId") REFERENCES "CostVendorProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EffectiveCost"
  ADD CONSTRAINT "EffectiveCost_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "CostVendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EffectiveCost"
  ADD CONSTRAINT "EffectiveCost_vendorProductId_fkey"
  FOREIGN KEY ("vendorProductId") REFERENCES "CostVendorProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
