-- Store worksheet item categories by stable EntityCategory.id. The legacy
-- category/entityType strings remain denormalized display snapshots for API
-- compatibility, but rollups and future writes resolve through categoryId.

ALTER TABLE "WorksheetItem" ADD COLUMN "categoryId" TEXT;

WITH item_orgs AS (
  SELECT DISTINCT p."organizationId"
  FROM "WorksheetItem" wi
  JOIN "Worksheet" w ON w."id" = wi."worksheetId"
  JOIN "QuoteRevision" qr ON qr."id" = w."revisionId"
  JOIN "Quote" q ON q."id" = qr."quoteId"
  JOIN "Project" p ON p."id" = q."projectId"
),
missing_fallbacks AS (
  SELECT io."organizationId"
  FROM item_orgs io
  WHERE NOT EXISTS (
    SELECT 1
    FROM "EntityCategory" ec
    WHERE ec."organizationId" = io."organizationId"
  )
)
INSERT INTO "EntityCategory" (
  "id",
  "organizationId",
  "name",
  "entityType",
  "shortform",
  "defaultUom",
  "validUoms",
  "editableFields",
  "laborHourLabels",
  "calculationType",
  "calcFormula",
  "itemSource",
  "analyticsBucket",
  "color",
  "order",
  "isBuiltIn",
  "enabled"
)
SELECT
  'ecat_' || md5(mf."organizationId" || '|Uncategorized'),
  mf."organizationId",
  'Uncategorized',
  'Uncategorized',
  'U',
  'EA',
  ARRAY['EA']::text[],
  '{"quantity":true,"cost":true,"markup":true,"price":true,"unit1":false,"unit2":false,"unit3":false}'::jsonb,
  '{"unit1":"","unit2":"","unit3":""}'::jsonb,
  'manual',
  '',
  'freeform',
  NULL,
  '#6b7280',
  999,
  false,
  true
FROM missing_fallbacks mf
ON CONFLICT ("organizationId", "name") DO NOTHING;

WITH item_org AS (
  SELECT
    wi."id" AS "worksheetItemId",
    wi."category",
    wi."entityType",
    p."organizationId"
  FROM "WorksheetItem" wi
  JOIN "Worksheet" w ON w."id" = wi."worksheetId"
  JOIN "QuoteRevision" qr ON qr."id" = w."revisionId"
  JOIN "Quote" q ON q."id" = qr."quoteId"
  JOIN "Project" p ON p."id" = q."projectId"
),
ranked_matches AS (
  SELECT
    io."worksheetItemId",
    ec."id" AS "categoryId",
    ec."name" AS "categoryName",
    ec."entityType" AS "categoryEntityType",
    row_number() OVER (
      PARTITION BY io."worksheetItemId"
      ORDER BY
        CASE
          WHEN lower(ec."name") = lower(NULLIF(io."category", '')) THEN 0
          WHEN lower(ec."entityType") = lower(NULLIF(io."entityType", '')) THEN 1
          WHEN lower(ec."name") = 'material' THEN 2
          WHEN lower(ec."name") = 'uncategorized' THEN 3
          WHEN ec."enabled" = true THEN 4
          ELSE 5
        END,
        ec."order" ASC,
        ec."name" ASC
    ) AS rn
  FROM item_org io
  JOIN "EntityCategory" ec ON ec."organizationId" = io."organizationId"
),
best_matches AS (
  SELECT *
  FROM ranked_matches
  WHERE rn = 1
)
UPDATE "WorksheetItem" wi
SET
  "categoryId" = bm."categoryId",
  "category" = bm."categoryName",
  "entityType" = bm."categoryEntityType"
FROM best_matches bm
WHERE wi."id" = bm."worksheetItemId";

ALTER TABLE "WorksheetItem" ALTER COLUMN "categoryId" SET NOT NULL;

CREATE INDEX "WorksheetItem_categoryId_idx" ON "WorksheetItem"("categoryId");

ALTER TABLE "WorksheetItem"
ADD CONSTRAINT "WorksheetItem_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "EntityCategory"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
