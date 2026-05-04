DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'QuoteRevision'
      AND column_name = 'ne' || 'caDifficulty'
  ) THEN
    EXECUTE format(
      'ALTER TABLE "QuoteRevision" RENAME COLUMN %I TO %I',
      'ne' || 'caDifficulty',
      'laborDifficulty'
    );
  END IF;
END $$;
