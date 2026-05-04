ALTER TABLE "QuoteRevision"
ADD COLUMN "pricingLadder" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "Adjustment"
ADD COLUMN "financialCategory" TEXT NOT NULL DEFAULT 'other',
ADD COLUMN "calculationBase" TEXT NOT NULL DEFAULT 'selected_scope',
ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Adjustment"
SET
  "financialCategory" = CASE
    WHEN lower("type") LIKE '%overhead%' THEN 'overhead'
    WHEN lower("type") LIKE '%profit%' OR lower("type") LIKE '%margin%' THEN 'profit'
    WHEN lower("type") LIKE '%tax%' OR lower("type") LIKE '%hst%' OR lower("type") LIKE '%gst%' OR lower("type") LIKE '%pst%' THEN 'tax'
    WHEN lower("type") LIKE '%contingenc%' THEN 'contingency'
    WHEN lower("type") LIKE '%insurance%' THEN 'insurance'
    WHEN lower("type") LIKE '%bond%' THEN 'bond'
    WHEN lower("type") LIKE '%allowance%' THEN 'allowance'
    WHEN lower("type") LIKE '%option%' OR lower("pricingMode") LIKE '%option%' THEN 'alternate'
    ELSE 'other'
  END,
  "calculationBase" = CASE
    WHEN "pricingMode" = 'modifier' THEN 'selected_scope'
    ELSE 'line_subtotal'
  END;
