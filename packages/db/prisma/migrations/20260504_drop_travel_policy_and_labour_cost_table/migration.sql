-- Drop FK from RateSchedule to TravelPolicy
ALTER TABLE "RateSchedule" DROP CONSTRAINT IF EXISTS "RateSchedule_travelPolicyId_fkey";
ALTER TABLE "RateSchedule" DROP COLUMN IF EXISTS "travelPolicyId";

-- Drop LabourCostEntry (children of LabourCostTable)
DROP TABLE IF EXISTS "LabourCostEntry" CASCADE;

-- Drop LabourCostTable
DROP TABLE IF EXISTS "LabourCostTable" CASCADE;

-- Drop TravelPolicy
DROP TABLE IF EXISTS "TravelPolicy" CASCADE;
