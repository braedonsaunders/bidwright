ALTER TABLE "EstimateFactor" ADD COLUMN "applicationScope" TEXT NOT NULL DEFAULT 'global';
ALTER TABLE "EstimateFactor" ADD COLUMN "formulaType" TEXT NOT NULL DEFAULT 'fixed_multiplier';
ALTER TABLE "EstimateFactor" ADD COLUMN "parameters" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "EstimateFactorLibraryEntry" ADD COLUMN "applicationScope" TEXT NOT NULL DEFAULT 'both';
ALTER TABLE "EstimateFactorLibraryEntry" ADD COLUMN "formulaType" TEXT NOT NULL DEFAULT 'fixed_multiplier';
ALTER TABLE "EstimateFactorLibraryEntry" ADD COLUMN "parameters" JSONB NOT NULL DEFAULT '{}';
