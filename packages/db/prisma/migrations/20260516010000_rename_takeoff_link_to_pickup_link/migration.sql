-- Full clean cutover: TakeoffLink → PickupLink. The relation is between a
-- Pickup and a WorksheetItem; the table name now matches that vocabulary.
ALTER TABLE "TakeoffLink" RENAME TO "PickupLink";
ALTER TABLE "PickupLink" RENAME CONSTRAINT "TakeoffLink_pkey" TO "PickupLink_pkey";
ALTER TABLE "PickupLink" RENAME CONSTRAINT "TakeoffLink_projectId_fkey" TO "PickupLink_projectId_fkey";
ALTER TABLE "PickupLink" RENAME CONSTRAINT "TakeoffLink_pickupId_fkey" TO "PickupLink_pickupId_fkey";
ALTER TABLE "PickupLink" RENAME CONSTRAINT "TakeoffLink_worksheetItemId_fkey" TO "PickupLink_worksheetItemId_fkey";
-- RENAME CONSTRAINT above already cascaded the pkey index rename, so no
-- explicit ALTER INDEX for the pkey is needed.
ALTER INDEX "TakeoffLink_pickupId_idx" RENAME TO "PickupLink_pickupId_idx";
ALTER INDEX "TakeoffLink_worksheetItemId_idx" RENAME TO "PickupLink_worksheetItemId_idx";
ALTER INDEX "TakeoffLink_projectId_idx" RENAME TO "PickupLink_projectId_idx";
ALTER INDEX "TakeoffLink_pickupId_worksheetItemId_key" RENAME TO "PickupLink_pickupId_worksheetItemId_key";
