ALTER TABLE "WorksheetItem"
  ADD COLUMN IF NOT EXISTS "costSnapshot" JSONB NOT NULL DEFAULT '{}'::jsonb;
