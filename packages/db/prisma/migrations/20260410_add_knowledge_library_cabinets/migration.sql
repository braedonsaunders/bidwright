CREATE TABLE "KnowledgeLibraryCabinet" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "parentId" TEXT,
  "itemType" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeLibraryCabinet_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "KnowledgeBook"
ADD COLUMN "cabinetId" TEXT;

ALTER TABLE "Dataset"
ADD COLUMN "cabinetId" TEXT;

CREATE INDEX "KnowledgeLibraryCabinet_organizationId_idx" ON "KnowledgeLibraryCabinet"("organizationId");
CREATE INDEX "KnowledgeLibraryCabinet_parentId_idx" ON "KnowledgeLibraryCabinet"("parentId");
CREATE INDEX "KnowledgeLibraryCabinet_organizationId_itemType_idx" ON "KnowledgeLibraryCabinet"("organizationId", "itemType");
CREATE INDEX "KnowledgeBook_cabinetId_idx" ON "KnowledgeBook"("cabinetId");
CREATE INDEX "Dataset_cabinetId_idx" ON "Dataset"("cabinetId");

ALTER TABLE "KnowledgeLibraryCabinet"
ADD CONSTRAINT "KnowledgeLibraryCabinet_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeLibraryCabinet"
ADD CONSTRAINT "KnowledgeLibraryCabinet_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "KnowledgeLibraryCabinet"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KnowledgeBook"
ADD CONSTRAINT "KnowledgeBook_cabinetId_fkey"
FOREIGN KEY ("cabinetId") REFERENCES "KnowledgeLibraryCabinet"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Dataset"
ADD CONSTRAINT "Dataset_cabinetId_fkey"
FOREIGN KEY ("cabinetId") REFERENCES "KnowledgeLibraryCabinet"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
