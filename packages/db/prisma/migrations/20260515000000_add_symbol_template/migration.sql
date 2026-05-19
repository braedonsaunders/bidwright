-- Symbol Library: per-project saved templates extracted from drawing
-- legends. Used by the "Run Project Library" few-shot symbol counter.
--
-- Cropped PNG bytes live on disk at
--   apiDataRoot/projects/<projectId>/symbol-templates/<id>.png
-- and only the relative path is stored here in storagePath.

CREATE TABLE "SymbolTemplate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL DEFAULT '',
    "label" TEXT NOT NULL DEFAULT '',
    "storagePath" TEXT NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "dpi" INTEGER NOT NULL DEFAULT 150,
    "sourceDocumentId" TEXT,
    "sourcePage" INTEGER NOT NULL DEFAULT 1,
    "sourceBbox" JSONB NOT NULL DEFAULT '{}',
    "threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "crossScale" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SymbolTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SymbolTemplate_projectId_idx" ON "SymbolTemplate"("projectId");
CREATE INDEX "SymbolTemplate_sourceDocumentId_idx" ON "SymbolTemplate"("sourceDocumentId");

ALTER TABLE "SymbolTemplate"
  ADD CONSTRAINT "SymbolTemplate_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SymbolTemplate"
  ADD CONSTRAINT "SymbolTemplate_sourceDocumentId_fkey"
  FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
