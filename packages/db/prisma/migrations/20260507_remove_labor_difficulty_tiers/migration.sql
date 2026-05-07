ALTER TABLE "LaborUnit"
  DROP COLUMN IF EXISTS "hoursDifficult",
  DROP COLUMN IF EXISTS "hoursVeryDifficult",
  DROP COLUMN IF EXISTS "defaultDifficulty";

ALTER TABLE "AssemblyComponent"
  DROP COLUMN IF EXISTS "laborDifficulty";

ALTER TABLE "QuoteRevision"
  DROP COLUMN IF EXISTS "laborDifficulty";
