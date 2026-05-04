ALTER TABLE "WorksheetItem" ADD COLUMN "classification" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "WorksheetItem" ADD COLUMN "costCode" TEXT;

CREATE INDEX "WorksheetItem_costCode_idx" ON "WorksheetItem"("costCode");

ALTER TABLE "summary_rows" ADD COLUMN "sourceWorksheetId" TEXT;
ALTER TABLE "summary_rows" ADD COLUMN "sourceWorksheetLabel" TEXT;
ALTER TABLE "summary_rows" ADD COLUMN "sourceClassificationId" TEXT;
ALTER TABLE "summary_rows" ADD COLUMN "sourceClassificationLabel" TEXT;
