CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS "LineItemSearchDocument" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "actionType" TEXT NOT NULL DEFAULT 'select',
  "category" TEXT NOT NULL DEFAULT '',
  "entityType" TEXT NOT NULL DEFAULT '',
  "title" TEXT NOT NULL,
  "subtitle" TEXT NOT NULL DEFAULT '',
  "code" TEXT NOT NULL DEFAULT '',
  "vendor" TEXT NOT NULL DEFAULT '',
  "uom" TEXT NOT NULL DEFAULT 'EA',
  "unitCost" DOUBLE PRECISION,
  "unitPrice" DOUBLE PRECISION,
  "searchText" TEXT NOT NULL DEFAULT '',
  "searchVector" tsvector NOT NULL DEFAULT ''::tsvector,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "LineItemSearchDocument_organizationId_idx"
  ON "LineItemSearchDocument"("organizationId");

CREATE INDEX IF NOT EXISTS "LineItemSearchDocument_organizationId_projectId_idx"
  ON "LineItemSearchDocument"("organizationId", "projectId");

CREATE INDEX IF NOT EXISTS "LineItemSearchDocument_organizationId_sourceType_idx"
  ON "LineItemSearchDocument"("organizationId", "sourceType");

CREATE INDEX IF NOT EXISTS "LineItemSearchDocument_organizationId_category_idx"
  ON "LineItemSearchDocument"("organizationId", "category");

CREATE INDEX IF NOT EXISTS "LineItemSearchDocument_organizationId_entityType_idx"
  ON "LineItemSearchDocument"("organizationId", "entityType");

CREATE INDEX IF NOT EXISTS "LineItemSearchDocument_searchText_fts_idx"
  ON "LineItemSearchDocument"
  USING GIN (to_tsvector('english', "searchText"));

CREATE INDEX IF NOT EXISTS "LineItemSearchDocument_searchVector_fts_idx"
  ON "LineItemSearchDocument"
  USING GIN ("searchVector");

CREATE INDEX IF NOT EXISTS "LineItemSearchDocument_searchText_trgm_idx"
  ON "LineItemSearchDocument"
  USING GIN ("searchText" gin_trgm_ops);
