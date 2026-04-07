ALTER TABLE "QuoteRevision"
ADD COLUMN "summaryLayoutPreset" TEXT NOT NULL DEFAULT 'custom';

CREATE TABLE "Adjustment" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL DEFAULT 'modifier',
    "pricingMode" TEXT NOT NULL DEFAULT 'modifier',
    "name" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT '',
    "appliesTo" TEXT NOT NULL DEFAULT 'All',
    "percentage" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION,
    "show" TEXT NOT NULL DEFAULT 'Yes',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Adjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Adjustment_revisionId_idx" ON "Adjustment"("revisionId");

ALTER TABLE "Adjustment"
ADD CONSTRAINT "Adjustment_revisionId_fkey"
FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "summary_rows"
ADD COLUMN "sourceCategoryId" TEXT,
ADD COLUMN "sourceCategoryLabel" TEXT,
ADD COLUMN "sourcePhaseId" TEXT,
ADD COLUMN "sourceAdjustmentId" TEXT;

WITH legacy_adjustments AS (
    SELECT
        CONCAT('adj_mod_', m."id") AS id,
        m."revisionId" AS "revisionId",
        'modifier'::TEXT AS kind,
        'modifier'::TEXT AS "pricingMode",
        m."name" AS name,
        ''::TEXT AS description,
        COALESCE(m."type", '') AS type,
        COALESCE(m."appliesTo", 'All') AS "appliesTo",
        m."percentage" AS percentage,
        m."amount" AS amount,
        COALESCE(m."show", 'Yes') AS show,
        0 AS source_group,
        m."id" AS source_id
    FROM "Modifier" m

    UNION ALL

    SELECT
        CONCAT('adj_ali_', a."id") AS id,
        a."revisionId" AS "revisionId",
        'line_item'::TEXT AS kind,
        CASE a."type"
            WHEN 'OptionStandalone' THEN 'option_standalone'
            WHEN 'OptionAdditional' THEN 'option_additional'
            WHEN 'LineItemStandalone' THEN 'line_item_standalone'
            WHEN 'CustomTotal' THEN 'custom_total'
            ELSE 'line_item_additional'
        END AS "pricingMode",
        a."name" AS name,
        COALESCE(a."description", '') AS description,
        COALESCE(a."type", '') AS type,
        'All'::TEXT AS "appliesTo",
        NULL::DOUBLE PRECISION AS percentage,
        a."amount" AS amount,
        'Yes'::TEXT AS show,
        1 AS source_group,
        a."id" AS source_id
    FROM "AdditionalLineItem" a
),
ordered_adjustments AS (
    SELECT
        id,
        "revisionId",
        ROW_NUMBER() OVER (PARTITION BY "revisionId" ORDER BY source_group, source_id) - 1 AS "order",
        kind,
        "pricingMode",
        name,
        description,
        type,
        "appliesTo",
        percentage,
        amount,
        show
    FROM legacy_adjustments
)
INSERT INTO "Adjustment" (
    "id",
    "revisionId",
    "order",
    "kind",
    "pricingMode",
    "name",
    "description",
    "type",
    "appliesTo",
    "percentage",
    "amount",
    "show"
)
SELECT
    oa.id,
    oa."revisionId",
    oa."order",
    oa.kind,
    oa."pricingMode",
    oa.name,
    oa.description,
    oa.type,
    oa."appliesTo",
    oa.percentage,
    oa.amount,
    oa.show
FROM ordered_adjustments oa
WHERE NOT EXISTS (
    SELECT 1
    FROM "Adjustment" existing
    WHERE existing."id" = oa.id
);

UPDATE "summary_rows"
SET
    "type" = CASE
        WHEN "type" = 'auto_category' THEN 'category'
        WHEN "type" = 'auto_phase' THEN 'phase'
        WHEN "type" = 'manual' THEN 'heading'
        WHEN "type" = 'modifier' THEN 'heading'
        ELSE "type"
    END,
    "sourceCategoryLabel" = COALESCE("sourceCategoryLabel", "sourceCategory");

UPDATE "summary_rows"
SET "sourceCategoryId" = CONCAT(
    'cat_',
    REGEXP_REPLACE(LOWER(COALESCE("sourceCategoryLabel", "sourceCategory", 'uncategorized')), '[^a-z0-9]+', '_', 'g')
)
WHERE "sourceCategoryId" IS NULL
  AND COALESCE("sourceCategoryLabel", "sourceCategory", '') <> '';

UPDATE "summary_rows" sr
SET "sourcePhaseId" = p."id"
FROM "Phase" p
WHERE sr."sourcePhaseId" IS NULL
  AND sr."revisionId" = p."revisionId"
  AND COALESCE(sr."sourcePhase", '') <> ''
  AND sr."sourcePhase" = p."name";
