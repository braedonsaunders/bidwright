-- Add durable Price Intelligence storage for normalized resources,
-- observed vendor prices, and effective costs used by estimating.

CREATE TABLE "ResourceCatalogItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "resourceType" TEXT NOT NULL DEFAULT 'material',
    "category" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "manufacturerPartNumber" TEXT NOT NULL DEFAULT '',
    "defaultUom" TEXT NOT NULL DEFAULT 'EA',
    "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceCatalogItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriceObservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "resourceId" TEXT,
    "projectId" TEXT,
    "sourceDocumentId" TEXT,
    "vendorName" TEXT NOT NULL DEFAULT '',
    "vendorSku" TEXT NOT NULL DEFAULT '',
    "documentType" TEXT NOT NULL DEFAULT 'manual',
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveDate" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "observedUom" TEXT NOT NULL DEFAULT 'EA',
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitPrice" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "freight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fingerprint" TEXT NOT NULL DEFAULT '',
    "sourceRef" JSONB NOT NULL DEFAULT '{}',
    "rawText" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EffectiveCost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "projectId" TEXT,
    "vendorName" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "uom" TEXT NOT NULL DEFAULT 'EA',
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitPrice" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effectiveDate" TEXT,
    "expiresAt" TEXT,
    "sourceObservationId" TEXT,
    "method" TEXT NOT NULL DEFAULT 'latest_observation',
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EffectiveCost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ResourceCatalogItem_organizationId_idx" ON "ResourceCatalogItem"("organizationId");
CREATE INDEX "ResourceCatalogItem_organizationId_resourceType_idx" ON "ResourceCatalogItem"("organizationId", "resourceType");
CREATE INDEX "ResourceCatalogItem_organizationId_code_idx" ON "ResourceCatalogItem"("organizationId", "code");
CREATE INDEX "ResourceCatalogItem_catalogItemId_idx" ON "ResourceCatalogItem"("catalogItemId");

CREATE INDEX "PriceObservation_organizationId_idx" ON "PriceObservation"("organizationId");
CREATE INDEX "PriceObservation_resourceId_observedAt_idx" ON "PriceObservation"("resourceId", "observedAt");
CREATE INDEX "PriceObservation_projectId_idx" ON "PriceObservation"("projectId");
CREATE INDEX "PriceObservation_sourceDocumentId_idx" ON "PriceObservation"("sourceDocumentId");
CREATE INDEX "PriceObservation_organizationId_vendorName_idx" ON "PriceObservation"("organizationId", "vendorName");
CREATE INDEX "PriceObservation_organizationId_fingerprint_idx" ON "PriceObservation"("organizationId", "fingerprint");

CREATE INDEX "EffectiveCost_organizationId_idx" ON "EffectiveCost"("organizationId");
CREATE INDEX "EffectiveCost_resourceId_idx" ON "EffectiveCost"("resourceId");
CREATE INDEX "EffectiveCost_projectId_idx" ON "EffectiveCost"("projectId");
CREATE INDEX "EffectiveCost_sourceObservationId_idx" ON "EffectiveCost"("sourceObservationId");
CREATE INDEX "EffectiveCost_organizationId_resourceId_uom_currency_idx" ON "EffectiveCost"("organizationId", "resourceId", "uom", "currency");

ALTER TABLE "ResourceCatalogItem"
  ADD CONSTRAINT "ResourceCatalogItem_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ResourceCatalogItem"
  ADD CONSTRAINT "ResourceCatalogItem_catalogItemId_fkey"
  FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PriceObservation"
  ADD CONSTRAINT "PriceObservation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PriceObservation"
  ADD CONSTRAINT "PriceObservation_resourceId_fkey"
  FOREIGN KEY ("resourceId") REFERENCES "ResourceCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PriceObservation"
  ADD CONSTRAINT "PriceObservation_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PriceObservation"
  ADD CONSTRAINT "PriceObservation_sourceDocumentId_fkey"
  FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EffectiveCost"
  ADD CONSTRAINT "EffectiveCost_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EffectiveCost"
  ADD CONSTRAINT "EffectiveCost_resourceId_fkey"
  FOREIGN KEY ("resourceId") REFERENCES "ResourceCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EffectiveCost"
  ADD CONSTRAINT "EffectiveCost_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EffectiveCost"
  ADD CONSTRAINT "EffectiveCost_sourceObservationId_fkey"
  FOREIGN KEY ("sourceObservationId") REFERENCES "PriceObservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
