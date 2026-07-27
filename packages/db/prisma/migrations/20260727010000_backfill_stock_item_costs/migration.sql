-- The tenant Stock Items import populated its source "price" column into
-- CatalogItem.unitPrice. In estimating, these values are supplier/library
-- unit costs: Material applies the quote's default markup and calculates sell.
-- Move only unambiguous rows so genuine cost+sell catalogues are untouched.
UPDATE "CatalogItem" ci
SET
  "unitCost" = ci."unitPrice",
  "unitPrice" = 0,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Catalog" c
WHERE c."id" = ci."catalogId"
  AND lower(trim(c."name")) = 'stock items'
  AND lower(trim(COALESCE(ci."metadata"->>'category', ''))) = 'stock item'
  AND ci."unitCost" = 0
  AND ci."unitPrice" <> 0;
