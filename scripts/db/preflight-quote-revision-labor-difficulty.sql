-- Deploy preflight for legacy QuoteRevision.necaDifficulty deployments.
-- Prisma db push treats a renamed populated column as a drop unless the rename
-- has already happened, so preserve the values before schema sync.

DO $$
BEGIN
  IF to_regclass('public."QuoteRevision"') IS NULL THEN
    RAISE NOTICE 'Skipping QuoteRevision laborDifficulty preflight; table is not present yet.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'QuoteRevision'
      AND column_name = 'necaDifficulty'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'QuoteRevision'
      AND column_name = 'laborDifficulty'
  ) THEN
    ALTER TABLE "QuoteRevision" RENAME COLUMN "necaDifficulty" TO "laborDifficulty";
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'QuoteRevision'
      AND column_name = 'necaDifficulty'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'QuoteRevision'
      AND column_name = 'laborDifficulty'
  ) THEN
    UPDATE "QuoteRevision"
    SET "laborDifficulty" = COALESCE(NULLIF("laborDifficulty", ''), "necaDifficulty", '')
    WHERE "necaDifficulty" IS NOT NULL;

    ALTER TABLE "QuoteRevision" DROP COLUMN "necaDifficulty";
  END IF;
END $$;
