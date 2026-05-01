-- Add nullable uom column to RateScheduleTier so tiers can be tagged with the
-- UoM they price (e.g. DAY/WEEK/MONTH for equipment rentals). The calc engine
-- prefers a tier whose uom matches the line item's uom; tiers without uom set
-- fall back to the existing multiplier/name-pattern matching.
ALTER TABLE "RateScheduleTier" ADD COLUMN "uom" TEXT;
