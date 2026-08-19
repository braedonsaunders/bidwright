-- A quote's status is its current revision's status.
--
-- "Quote"."status" was written once at creation ('draft') and never updated,
-- while estimators set status on the revision. Every quote-list and dashboard
-- row read the stale copy and rendered "Other" — including quotes that had
-- actually been marked Awarded. Rather than keep two sources of truth in sync,
-- drop the duplicate.
ALTER TABLE "Quote" DROP COLUMN IF EXISTS "status";
