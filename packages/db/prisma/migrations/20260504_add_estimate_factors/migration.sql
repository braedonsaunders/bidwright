CREATE TABLE "EstimateFactor" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'Productivity',
    "impact" TEXT NOT NULL DEFAULT 'labor_hours',
    "value" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "appliesTo" TEXT NOT NULL DEFAULT 'Labour',
    "scope" JSONB NOT NULL DEFAULT '{}',
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "sourceType" TEXT NOT NULL DEFAULT 'custom',
    "sourceId" TEXT,
    "sourceRef" JSONB NOT NULL DEFAULT '{}',
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EstimateFactor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EstimateFactor_revisionId_idx" ON "EstimateFactor"("revisionId");
CREATE INDEX "EstimateFactor_sourceType_idx" ON "EstimateFactor"("sourceType");

ALTER TABLE "EstimateFactor" ADD CONSTRAINT "EstimateFactor_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
