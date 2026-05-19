-- Rename TakeoffAnnotation → Pickup end-to-end. The estimator-facing
-- vocabulary is "Pickup" now (a measurable mark on a drawing that can be
-- promoted to a worksheet line item). The schema shape is unchanged; only
-- names move. All existing rows / FK references / indexes are preserved.

-- 1. Drop the FK on the M:N junction so we can rename the parent table.
ALTER TABLE "TakeoffLink" DROP CONSTRAINT "TakeoffLink_annotationId_fkey";

-- 2. Rename the main table + its pk constraint + its indexes.
ALTER TABLE "TakeoffAnnotation" RENAME TO "Pickup";
ALTER TABLE "Pickup" RENAME CONSTRAINT "TakeoffAnnotation_projectId_fkey" TO "Pickup_projectId_fkey";
ALTER INDEX "TakeoffAnnotation_pkey" RENAME TO "Pickup_pkey";
ALTER INDEX "TakeoffAnnotation_projectId_idx" RENAME TO "Pickup_projectId_idx";
ALTER INDEX "TakeoffAnnotation_documentId_idx" RENAME TO "Pickup_documentId_idx";

-- 3. Rename TakeoffLink's foreign-key column + restore the FK pointing at
--    the renamed parent table.
ALTER TABLE "TakeoffLink" RENAME COLUMN "annotationId" TO "pickupId";
ALTER TABLE "TakeoffLink" ADD CONSTRAINT "TakeoffLink_pickupId_fkey"
  FOREIGN KEY ("pickupId") REFERENCES "Pickup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Rename the related indexes + unique constraint on the junction.
ALTER INDEX "TakeoffLink_annotationId_idx" RENAME TO "TakeoffLink_pickupId_idx";
ALTER INDEX "TakeoffLink_annotationId_worksheetItemId_key" RENAME TO "TakeoffLink_pickupId_worksheetItemId_key";
