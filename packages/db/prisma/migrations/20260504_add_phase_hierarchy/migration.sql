ALTER TABLE "Phase" ADD COLUMN "parentId" TEXT;

CREATE INDEX "Phase_parentId_idx" ON "Phase"("parentId");

ALTER TABLE "Phase" ADD CONSTRAINT "Phase_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Phase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
