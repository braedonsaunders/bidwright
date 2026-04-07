ALTER TABLE "EstimatorPersona"
ADD COLUMN "commercialGuidance" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "defaultAssumptions" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "packageBuckets" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "productivityGuidance" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "reviewFocusAreas" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "EstimateStrategy" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "aiRunId" TEXT,
    "personaId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currentStage" TEXT NOT NULL DEFAULT 'scope',
    "scopeGraph" JSONB NOT NULL DEFAULT '{}',
    "executionPlan" JSONB NOT NULL DEFAULT '{}',
    "assumptions" JSONB NOT NULL DEFAULT '[]',
    "packagePlan" JSONB NOT NULL DEFAULT '[]',
    "benchmarkProfile" JSONB NOT NULL DEFAULT '{}',
    "benchmarkComparables" JSONB NOT NULL DEFAULT '[]',
    "adjustmentPlan" JSONB NOT NULL DEFAULT '[]',
    "reconcileReport" JSONB NOT NULL DEFAULT '{}',
    "confidenceSummary" JSONB NOT NULL DEFAULT '{}',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "reviewRequired" BOOLEAN NOT NULL DEFAULT true,
    "reviewCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstimateStrategy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EstimateCalibrationFeedback" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "strategyId" TEXT,
    "quoteReviewId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "feedbackType" TEXT NOT NULL DEFAULT 'comparison',
    "sourceLabel" TEXT NOT NULL DEFAULT '',
    "aiSnapshot" JSONB NOT NULL DEFAULT '{}',
    "humanSnapshot" JSONB NOT NULL DEFAULT '{}',
    "deltaSummary" JSONB NOT NULL DEFAULT '{}',
    "corrections" JSONB NOT NULL DEFAULT '[]',
    "lessons" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstimateCalibrationFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EstimateStrategy_revisionId_key" ON "EstimateStrategy"("revisionId");
CREATE INDEX "EstimateStrategy_projectId_idx" ON "EstimateStrategy"("projectId");
CREATE INDEX "EstimateStrategy_status_idx" ON "EstimateStrategy"("status");
CREATE INDEX "EstimateCalibrationFeedback_projectId_idx" ON "EstimateCalibrationFeedback"("projectId");
CREATE INDEX "EstimateCalibrationFeedback_revisionId_idx" ON "EstimateCalibrationFeedback"("revisionId");
CREATE INDEX "EstimateCalibrationFeedback_strategyId_idx" ON "EstimateCalibrationFeedback"("strategyId");

ALTER TABLE "EstimateStrategy"
ADD CONSTRAINT "EstimateStrategy_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EstimateStrategy"
ADD CONSTRAINT "EstimateStrategy_revisionId_fkey"
FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EstimateCalibrationFeedback"
ADD CONSTRAINT "EstimateCalibrationFeedback_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EstimateCalibrationFeedback"
ADD CONSTRAINT "EstimateCalibrationFeedback_revisionId_fkey"
FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EstimateCalibrationFeedback"
ADD CONSTRAINT "EstimateCalibrationFeedback_strategyId_fkey"
FOREIGN KEY ("strategyId") REFERENCES "EstimateStrategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EstimateCalibrationFeedback"
ADD CONSTRAINT "EstimateCalibrationFeedback_quoteReviewId_fkey"
FOREIGN KEY ("quoteReviewId") REFERENCES "QuoteReview"("id") ON DELETE SET NULL ON UPDATE CASCADE;
