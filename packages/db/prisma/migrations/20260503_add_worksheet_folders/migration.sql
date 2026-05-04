CREATE TABLE "WorksheetFolder" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL DEFAULT 'Folder',
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "WorksheetFolder_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Worksheet" ADD COLUMN "folderId" TEXT;

CREATE INDEX "WorksheetFolder_revisionId_idx" ON "WorksheetFolder"("revisionId");
CREATE INDEX "WorksheetFolder_parentId_idx" ON "WorksheetFolder"("parentId");
CREATE INDEX "Worksheet_folderId_idx" ON "Worksheet"("folderId");

ALTER TABLE "WorksheetFolder" ADD CONSTRAINT "WorksheetFolder_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorksheetFolder" ADD CONSTRAINT "WorksheetFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WorksheetFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Worksheet" ADD CONSTRAINT "Worksheet_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "WorksheetFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
