-- Per-line derivation ledger.
--
-- Additive only: the shared prod/local database must keep serving the running
-- app while this is applied. WorksheetItem gains a nullable JSON column holding
-- the current derivation (formula + sourced inputs + result + status), and a
-- new append-only table records every version and invalidation.
ALTER TABLE "WorksheetItem" ADD COLUMN IF NOT EXISTS "derivation" JSONB;

CREATE TABLE IF NOT EXISTS "LineDerivationEvent" (
  "id"          TEXT NOT NULL,
  "projectId"   TEXT NOT NULL,
  "revisionId"  TEXT NOT NULL,
  "itemId"      TEXT NOT NULL,
  "version"     INTEGER NOT NULL,
  "cause"       TEXT NOT NULL,
  "actorKind"   TEXT NOT NULL DEFAULT 'system',
  "actorRef"    TEXT,
  "derivation"  JSONB NOT NULL,
  "changes"     JSONB NOT NULL DEFAULT '[]',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LineDerivationEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LineDerivationEvent_projectId_itemId_createdAt_idx"
  ON "LineDerivationEvent"("projectId", "itemId", "createdAt");
CREATE INDEX IF NOT EXISTS "LineDerivationEvent_revisionId_idx"
  ON "LineDerivationEvent"("revisionId");
