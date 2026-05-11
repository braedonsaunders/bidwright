ALTER TABLE "SuperAdmin"
  ADD COLUMN "integrations" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "preferences"  JSONB NOT NULL DEFAULT '{}'::jsonb;
