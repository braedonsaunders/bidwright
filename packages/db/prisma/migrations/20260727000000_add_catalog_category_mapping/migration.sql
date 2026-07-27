CREATE TABLE "CatalogCategoryMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "sourceCategory" TEXT NOT NULL DEFAULT '',
    "entityCategoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogCategoryMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogCategoryMapping_organizationId_catalogId_sourceCategory_key"
ON "CatalogCategoryMapping"("organizationId", "catalogId", "sourceCategory");

CREATE INDEX "CatalogCategoryMapping_organizationId_idx"
ON "CatalogCategoryMapping"("organizationId");

CREATE INDEX "CatalogCategoryMapping_catalogId_idx"
ON "CatalogCategoryMapping"("catalogId");

CREATE INDEX "CatalogCategoryMapping_entityCategoryId_idx"
ON "CatalogCategoryMapping"("entityCategoryId");

ALTER TABLE "CatalogCategoryMapping"
ADD CONSTRAINT "CatalogCategoryMapping_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CatalogCategoryMapping"
ADD CONSTRAINT "CatalogCategoryMapping_catalogId_fkey"
FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CatalogCategoryMapping"
ADD CONSTRAINT "CatalogCategoryMapping_entityCategoryId_fkey"
FOREIGN KEY ("entityCategoryId") REFERENCES "EntityCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing Stock Items imports use metadata.category = "Stock Item". Map
-- those catalogues to the tenant's Material estimate category.
INSERT INTO "CatalogCategoryMapping" (
  "id",
  "organizationId",
  "catalogId",
  "sourceCategory",
  "entityCategoryId",
  "createdAt",
  "updatedAt"
)
SELECT
  'ccm_' || md5(concat_ws('|', c."organizationId", c."id", 'Stock Item', ec."id")),
  c."organizationId",
  c."id",
  'Stock Item',
  ec."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Catalog" c
JOIN "EntityCategory" ec
  ON ec."organizationId" = c."organizationId"
WHERE c."organizationId" IS NOT NULL
  AND lower(trim(c."name")) = 'stock items'
  AND lower(trim(ec."name")) = 'material'
ON CONFLICT ("organizationId", "catalogId", "sourceCategory")
DO UPDATE SET
  "entityCategoryId" = EXCLUDED."entityCategoryId",
  "updatedAt" = CURRENT_TIMESTAMP;
