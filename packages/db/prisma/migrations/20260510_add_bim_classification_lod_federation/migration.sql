-- Phase 2 of the BIM workspace overhaul:
--   1. Promote `classification`, `lod`, `lodSource` from the ModelElement
--      `properties` JSON blob to typed columns. The `classification` shape
--      mirrors WorksheetItem.classification (see classification-utils.ts) so
--      element codes propagate cleanly into the existing summary rollups
--      (by_uniformat_division, by_masterformat_division, etc).
--   2. Add ModelFederation + ModelFederationMember to support multi-discipline
--      coordination (architectural + structural + MEP authored separately,
--      federated for one takeoff). Federations are standalone, optionally
--      linked to a quote revision for scenario branching.

-- 1. ModelElement: typed BIM-takeoff fields
ALTER TABLE "ModelElement"
  ADD COLUMN "classification" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "lod"            TEXT  NOT NULL DEFAULT '',
  ADD COLUMN "lodSource"      TEXT  NOT NULL DEFAULT '';

CREATE INDEX "ModelElement_lod_idx" ON "ModelElement"("lod");

-- 2. ModelFederation
CREATE TABLE "ModelFederation" (
  "id"          TEXT NOT NULL,
  "projectId"   TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "revisionId"  TEXT,
  "status"      TEXT NOT NULL DEFAULT 'active',
  "metadata"    JSONB NOT NULL DEFAULT '{}',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ModelFederation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ModelFederation_projectId_idx"  ON "ModelFederation"("projectId");
CREATE INDEX "ModelFederation_revisionId_idx" ON "ModelFederation"("revisionId");

ALTER TABLE "ModelFederation"
  ADD CONSTRAINT "ModelFederation_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelFederation"
  ADD CONSTRAINT "ModelFederation_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. ModelFederationMember
CREATE TABLE "ModelFederationMember" (
  "id"           TEXT NOT NULL,
  "federationId" TEXT NOT NULL,
  "modelId"      TEXT NOT NULL,
  "discipline"   TEXT NOT NULL DEFAULT 'other',
  "role"         TEXT NOT NULL DEFAULT 'primary',
  "position"     INTEGER NOT NULL DEFAULT 0,
  "metadata"     JSONB NOT NULL DEFAULT '{}',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ModelFederationMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModelFederationMember_federationId_modelId_key"
  ON "ModelFederationMember"("federationId", "modelId");
CREATE INDEX "ModelFederationMember_federationId_idx" ON "ModelFederationMember"("federationId");
CREATE INDEX "ModelFederationMember_modelId_idx"      ON "ModelFederationMember"("modelId");

ALTER TABLE "ModelFederationMember"
  ADD CONSTRAINT "ModelFederationMember_federationId_fkey"
  FOREIGN KEY ("federationId") REFERENCES "ModelFederation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelFederationMember"
  ADD CONSTRAINT "ModelFederationMember_modelId_fkey"
  FOREIGN KEY ("modelId") REFERENCES "ModelAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
