-- Canonicalize legacy EntityCategory records so old calculation names and
-- labor-hour JSON keys cannot disable modern worksheet behavior.

WITH normalized AS (
  SELECT
    "id",
    CASE lower(trim("calculationType"))
      WHEN 'auto_labour' THEN 'tiered_rate'
      WHEN 'auto_labor' THEN 'tiered_rate'
      WHEN 'labour' THEN 'tiered_rate'
      WHEN 'labor' THEN 'tiered_rate'
      WHEN 'hours' THEN 'tiered_rate'
      WHEN 'labour_rate' THEN 'tiered_rate'
      WHEN 'labor_rate' THEN 'tiered_rate'
      WHEN 'rate_schedule' THEN 'tiered_rate'
      WHEN 'auto_equipment' THEN 'duration_rate'
      WHEN 'equipment' THEN 'duration_rate'
      WHEN 'equipment_duration' THEN 'duration_rate'
      WHEN 'rental_equipment' THEN 'duration_rate'
      WHEN 'rental' THEN 'duration_rate'
      WHEN 'duration' THEN 'duration_rate'
      WHEN 'auto_consumable' THEN 'quantity_markup'
      WHEN 'consumable' THEN 'quantity_markup'
      WHEN 'quantity' THEN 'quantity_markup'
      WHEN 'quantity_rate' THEN 'quantity_markup'
      WHEN 'quantity_cost' THEN 'quantity_markup'
      WHEN 'cost_plus' THEN 'unit_markup'
      WHEN 'unit_price' THEN 'unit_markup'
      WHEN 'unit_cost' THEN 'unit_markup'
      WHEN 'direct_price' THEN 'direct_total'
      WHEN 'fixed_price' THEN 'direct_total'
      WHEN 'lump_sum' THEN 'direct_total'
      WHEN 'lump_sum_price' THEN 'direct_total'
      WHEN 'manual' THEN 'manual'
      WHEN 'unit_markup' THEN 'unit_markup'
      WHEN 'quantity_markup' THEN 'quantity_markup'
      WHEN 'tiered_rate' THEN 'tiered_rate'
      WHEN 'duration_rate' THEN 'duration_rate'
      WHEN 'direct_total' THEN 'direct_total'
      WHEN 'formula' THEN 'formula'
      ELSE 'manual'
    END AS "canonicalCalculationType"
  FROM "EntityCategory"
)
UPDATE "EntityCategory" ec
SET
  "calculationType" = n."canonicalCalculationType",
  "itemSource" = CASE
    WHEN lower(trim(ec."calculationType")) IN ('auto_labour', 'auto_labor', 'labour', 'labor', 'hours', 'labour_rate', 'labor_rate', 'rate_schedule') THEN 'rate_schedule'
    WHEN ec."itemSource" IN ('rate_schedule', 'catalog', 'freeform') THEN ec."itemSource"
    WHEN n."canonicalCalculationType" = 'tiered_rate' THEN 'rate_schedule'
    WHEN n."canonicalCalculationType" = 'duration_rate' THEN 'catalog'
    ELSE 'freeform'
  END,
  "analyticsBucket" = CASE
    WHEN ec."analyticsBucket" IS NOT NULL AND btrim(ec."analyticsBucket") <> '' THEN ec."analyticsBucket"
    WHEN ec."name" ~* 'labou?r' OR ec."entityType" ~* 'labou?r' THEN 'labour'
    WHEN ec."name" ~* 'equipment|rental' OR ec."entityType" ~* 'equipment|rental' THEN 'equipment'
    WHEN ec."name" ~* 'subcontract|sub contractor|sub-contractor' OR ec."entityType" ~* 'subcontract|sub contractor|sub-contractor' THEN 'subcontractor'
    WHEN ec."name" ~* 'allowance' OR ec."entityType" ~* 'allowance' THEN 'allowance'
    WHEN ec."name" ~* 'material|consumable' OR ec."entityType" ~* 'material|consumable' THEN 'material'
    ELSE ec."analyticsBucket"
  END,
  "editableFields" = jsonb_build_object(
    'quantity',
      COALESCE(
        CASE WHEN jsonb_typeof(ec."editableFields"->'quantity') = 'boolean' THEN (ec."editableFields"->>'quantity')::boolean END,
        CASE WHEN n."canonicalCalculationType" = 'direct_total' THEN false ELSE true END
      ),
    'cost',
      COALESCE(
        CASE WHEN jsonb_typeof(ec."editableFields"->'cost') = 'boolean' THEN (ec."editableFields"->>'cost')::boolean END,
        CASE WHEN n."canonicalCalculationType" IN ('tiered_rate', 'duration_rate', 'direct_total') THEN false ELSE true END
      ),
    'markup',
      COALESCE(
        CASE WHEN jsonb_typeof(ec."editableFields"->'markup') = 'boolean' THEN (ec."editableFields"->>'markup')::boolean END,
        CASE WHEN n."canonicalCalculationType" IN ('tiered_rate', 'duration_rate', 'direct_total') THEN false ELSE true END
      ),
    'price',
      COALESCE(
        CASE WHEN jsonb_typeof(ec."editableFields"->'price') = 'boolean' THEN (ec."editableFields"->>'price')::boolean END,
        CASE WHEN n."canonicalCalculationType" IN ('manual', 'direct_total') THEN true ELSE false END
      ),
    'unit1',
      COALESCE(
        CASE WHEN jsonb_typeof(ec."editableFields"->'unit1') = 'boolean' THEN (ec."editableFields"->>'unit1')::boolean END,
        CASE WHEN jsonb_typeof(ec."editableFields"->'laborHourReg') = 'boolean' THEN (ec."editableFields"->>'laborHourReg')::boolean END,
        CASE WHEN jsonb_typeof(ec."editableFields"->'labourHourReg') = 'boolean' THEN (ec."editableFields"->>'labourHourReg')::boolean END,
        CASE WHEN jsonb_typeof(ec."editableFields"->'reg') = 'boolean' THEN (ec."editableFields"->>'reg')::boolean END,
        CASE WHEN n."canonicalCalculationType" IN ('tiered_rate', 'duration_rate', 'formula') THEN true ELSE false END
      ),
    'unit2',
      COALESCE(
        CASE WHEN jsonb_typeof(ec."editableFields"->'unit2') = 'boolean' THEN (ec."editableFields"->>'unit2')::boolean END,
        CASE WHEN jsonb_typeof(ec."editableFields"->'laborHourOver') = 'boolean' THEN (ec."editableFields"->>'laborHourOver')::boolean END,
        CASE WHEN jsonb_typeof(ec."editableFields"->'labourHourOver') = 'boolean' THEN (ec."editableFields"->>'labourHourOver')::boolean END,
        CASE WHEN jsonb_typeof(ec."editableFields"->'over') = 'boolean' THEN (ec."editableFields"->>'over')::boolean END,
        CASE WHEN n."canonicalCalculationType" IN ('tiered_rate', 'formula') THEN true ELSE false END
      ),
    'unit3',
      COALESCE(
        CASE WHEN jsonb_typeof(ec."editableFields"->'unit3') = 'boolean' THEN (ec."editableFields"->>'unit3')::boolean END,
        CASE WHEN jsonb_typeof(ec."editableFields"->'laborHourDouble') = 'boolean' THEN (ec."editableFields"->>'laborHourDouble')::boolean END,
        CASE WHEN jsonb_typeof(ec."editableFields"->'labourHourDouble') = 'boolean' THEN (ec."editableFields"->>'labourHourDouble')::boolean END,
        CASE WHEN jsonb_typeof(ec."editableFields"->'double') = 'boolean' THEN (ec."editableFields"->>'double')::boolean END,
        CASE WHEN n."canonicalCalculationType" IN ('tiered_rate', 'formula') THEN true ELSE false END
      )
  ),
  "laborHourLabels" = jsonb_build_object(
    'unit1',
      COALESCE(
        NULLIF(ec."laborHourLabels"->>'unit1', ''),
        NULLIF(ec."laborHourLabels"->>'laborHourReg', ''),
        NULLIF(ec."laborHourLabels"->>'labourHourReg', ''),
        NULLIF(ec."laborHourLabels"->>'reg', ''),
        NULLIF(ec."laborHourLabels"->>'regular', ''),
        CASE
          WHEN n."canonicalCalculationType" = 'tiered_rate' THEN 'Reg Hrs'
          WHEN n."canonicalCalculationType" = 'duration_rate' THEN 'Duration'
          ELSE ''
        END
      ),
    'unit2',
      COALESCE(
        NULLIF(ec."laborHourLabels"->>'unit2', ''),
        NULLIF(ec."laborHourLabels"->>'laborHourOver', ''),
        NULLIF(ec."laborHourLabels"->>'labourHourOver', ''),
        NULLIF(ec."laborHourLabels"->>'over', ''),
        NULLIF(ec."laborHourLabels"->>'overtime', ''),
        CASE WHEN n."canonicalCalculationType" = 'tiered_rate' THEN 'OT Hrs' ELSE '' END
      ),
    'unit3',
      COALESCE(
        NULLIF(ec."laborHourLabels"->>'unit3', ''),
        NULLIF(ec."laborHourLabels"->>'laborHourDouble', ''),
        NULLIF(ec."laborHourLabels"->>'labourHourDouble', ''),
        NULLIF(ec."laborHourLabels"->>'double', ''),
        NULLIF(ec."laborHourLabels"->>'doubletime', ''),
        CASE WHEN n."canonicalCalculationType" = 'tiered_rate' THEN 'DT Hrs' ELSE '' END
      )
  )
FROM normalized n
WHERE ec."id" = n."id";
