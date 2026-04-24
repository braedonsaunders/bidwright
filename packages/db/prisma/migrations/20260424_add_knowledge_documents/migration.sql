-- Add first-class manually-authored knowledge pages/documents.

ALTER TABLE "EstimatorPersona"
  ADD COLUMN IF NOT EXISTS "knowledgeDocumentIds" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cabinetId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'general',
    "scope" TEXT NOT NULL DEFAULT 'global',
    "projectId" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeDocumentPage" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,
    "contentJson" JSONB NOT NULL DEFAULT '{}',
    "contentMarkdown" TEXT NOT NULL DEFAULT '',
    "plainText" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocumentPage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeDocumentChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "pageId" TEXT,
    "sectionTitle" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "KnowledgeDocumentChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KnowledgeDocument_organizationId_idx" ON "KnowledgeDocument"("organizationId");
CREATE INDEX "KnowledgeDocument_cabinetId_idx" ON "KnowledgeDocument"("cabinetId");
CREATE INDEX "KnowledgeDocument_scope_idx" ON "KnowledgeDocument"("scope");
CREATE INDEX "KnowledgeDocument_projectId_idx" ON "KnowledgeDocument"("projectId");
CREATE INDEX "KnowledgeDocumentPage_documentId_idx" ON "KnowledgeDocumentPage"("documentId");
CREATE INDEX "KnowledgeDocumentPage_documentId_order_idx" ON "KnowledgeDocumentPage"("documentId", "order");
CREATE INDEX "KnowledgeDocumentChunk_documentId_idx" ON "KnowledgeDocumentChunk"("documentId");
CREATE INDEX "KnowledgeDocumentChunk_pageId_idx" ON "KnowledgeDocumentChunk"("pageId");

ALTER TABLE "KnowledgeDocument"
  ADD CONSTRAINT "KnowledgeDocument_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeDocument"
  ADD CONSTRAINT "KnowledgeDocument_cabinetId_fkey"
  FOREIGN KEY ("cabinetId") REFERENCES "KnowledgeLibraryCabinet"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KnowledgeDocumentPage"
  ADD CONSTRAINT "KnowledgeDocumentPage_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeDocumentChunk"
  ADD CONSTRAINT "KnowledgeDocumentChunk_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeDocumentChunk"
  ADD CONSTRAINT "KnowledgeDocumentChunk_pageId_fkey"
  FOREIGN KEY ("pageId") REFERENCES "KnowledgeDocumentPage"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
