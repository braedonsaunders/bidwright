-- Reviewed-only calibration learning.
--
-- Captured lessons were never reused: nothing distinguished an estimator-
-- approved lesson from an unreviewed capture, so the agent was shown raw
-- feedback rows or nothing. Add a review state and an approved-lessons list.
-- Additive only; the database is shared with the running app.
ALTER TABLE "EstimateCalibrationFeedback" ADD COLUMN IF NOT EXISTS "reviewStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "EstimateCalibrationFeedback" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
ALTER TABLE "EstimateCalibrationFeedback" ADD COLUMN IF NOT EXISTS "reviewedBy" TEXT;
ALTER TABLE "EstimateCalibrationFeedback" ADD COLUMN IF NOT EXISTS "reviewNotes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "EstimateCalibrationFeedback" ADD COLUMN IF NOT EXISTS "approvedLessons" JSONB NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS "EstimateCalibrationFeedback_reviewStatus_idx" ON "EstimateCalibrationFeedback"("reviewStatus");
