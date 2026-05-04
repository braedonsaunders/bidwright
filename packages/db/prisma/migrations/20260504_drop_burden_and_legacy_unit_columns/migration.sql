-- Drop BurdenPeriod table.
DROP TABLE IF EXISTS "BurdenPeriod" CASCADE;

-- Backfill WorksheetItem.tierUnits from the legacy laborHourReg/Over/Double columns
-- before we drop them. We map by RateScheduleTier.multiplier (1.0 → reg, 1.5 → ot, 2.0 → dt).
-- Rows without a rateScheduleItemId, or whose schedule lacks a matching tier, get an empty
-- tierUnits — they will need to be re-priced from the UI.
DO $$
DECLARE
  rec RECORD;
  reg_id text;
  ot_id  text;
  dt_id  text;
  tier_units jsonb;
BEGIN
  FOR rec IN
    SELECT
      wi.id            AS item_id,
      wi."laborHourReg"    AS u1,
      wi."laborHourOver"   AS u2,
      wi."laborHourDouble" AS u3,
      rsi."scheduleId" AS schedule_id
    FROM "WorksheetItem" wi
    JOIN "RateScheduleItem" rsi ON rsi.id = wi."rateScheduleItemId"
    WHERE wi."rateScheduleItemId" IS NOT NULL
      AND (wi."laborHourReg" > 0 OR wi."laborHourOver" > 0 OR wi."laborHourDouble" > 0)
      AND (wi."tierUnits" IS NULL OR wi."tierUnits"::text = '{}')
  LOOP
    SELECT id INTO reg_id FROM "RateScheduleTier"
      WHERE "scheduleId" = rec.schedule_id AND multiplier = 1.0 LIMIT 1;
    SELECT id INTO ot_id FROM "RateScheduleTier"
      WHERE "scheduleId" = rec.schedule_id AND multiplier = 1.5 LIMIT 1;
    SELECT id INTO dt_id FROM "RateScheduleTier"
      WHERE "scheduleId" = rec.schedule_id AND multiplier = 2.0 LIMIT 1;

    tier_units := '{}'::jsonb;
    IF reg_id IS NOT NULL AND rec.u1 > 0 THEN
      tier_units := tier_units || jsonb_build_object(reg_id, rec.u1);
    END IF;
    IF ot_id IS NOT NULL AND rec.u2 > 0 THEN
      tier_units := tier_units || jsonb_build_object(ot_id, rec.u2);
    END IF;
    IF dt_id IS NOT NULL AND rec.u3 > 0 THEN
      tier_units := tier_units || jsonb_build_object(dt_id, rec.u3);
    END IF;

    IF tier_units <> '{}'::jsonb THEN
      UPDATE "WorksheetItem" SET "tierUnits" = tier_units WHERE id = rec.item_id;
    END IF;
  END LOOP;
END $$;

-- Drop the legacy hour columns. tierUnits is the only source of truth going forward.
ALTER TABLE "WorksheetItem" DROP COLUMN IF EXISTS "laborHourReg";
ALTER TABLE "WorksheetItem" DROP COLUMN IF EXISTS "laborHourOver";
ALTER TABLE "WorksheetItem" DROP COLUMN IF EXISTS "laborHourDouble";
