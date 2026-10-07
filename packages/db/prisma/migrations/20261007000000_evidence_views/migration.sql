-- Images the server rendered and returned to an agent tool call. Drawing-based
-- quantities cite these ids (EvidenceView.id), tying a number to exact pixels.

-- CreateTable
CREATE TABLE IF NOT EXISTS "EvidenceView" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT,
    "sessionId" TEXT,
    "documentId" TEXT,
    "fileNodeId" TEXT,
    "sourceChecksum" TEXT,
    "pageNumber" INTEGER NOT NULL,
    "bbox" JSONB,
    "rotation" INTEGER NOT NULL DEFAULT 0,
    "dpi" INTEGER NOT NULL,
    "imageWidth" INTEGER NOT NULL,
    "imageHeight" INTEGER NOT NULL,
    "imageHash" TEXT NOT NULL,
    "cropPath" TEXT,
    "tool" TEXT NOT NULL,
    "textSnippet" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EvidenceView_projectId_createdAt_idx" ON "EvidenceView"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EvidenceView_runId_idx" ON "EvidenceView"("runId");

