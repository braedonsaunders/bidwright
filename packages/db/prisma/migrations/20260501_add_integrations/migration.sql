-- Integrations: manifest-driven framework for connecting external systems.
-- Distinct namespace from Plugin — integrations target outside systems
-- (NetSuite, Procore, QuickBooks, Slack, custom REST, ...) and surface
-- as `integration.{slug}.{action}` tools to the agent and MCP server.

CREATE TABLE "Integration" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "manifestId"       TEXT NOT NULL,
  "manifestVersion"  TEXT NOT NULL,
  "manifestSource"   TEXT NOT NULL DEFAULT 'builtin',
  "manifestSnapshot" JSONB NOT NULL,
  "slug"             TEXT NOT NULL,
  "displayName"      TEXT NOT NULL,
  "description"      TEXT NOT NULL DEFAULT '',
  "icon"             TEXT,
  "category"         TEXT NOT NULL DEFAULT 'other',
  "enabled"          BOOLEAN NOT NULL DEFAULT true,
  "status"           TEXT NOT NULL DEFAULT 'needs_auth',
  "lastError"        TEXT,
  "lastTestedAt"     TIMESTAMP(3),
  "lastConnectedAt"  TIMESTAMP(3),
  "config"           JSONB NOT NULL DEFAULT '{}',
  "scopes"           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "exposeToAgent"    BOOLEAN NOT NULL DEFAULT true,
  "exposeToMcp"      BOOLEAN NOT NULL DEFAULT true,
  "createdBy"        TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Integration_organizationId_slug_key"
  ON "Integration"("organizationId", "slug");
CREATE INDEX "Integration_organizationId_idx" ON "Integration"("organizationId");
CREATE INDEX "Integration_manifestId_idx"     ON "Integration"("manifestId");
CREATE INDEX "Integration_status_idx"         ON "Integration"("status");

ALTER TABLE "Integration"
  ADD CONSTRAINT "Integration_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;


CREATE TABLE "IntegrationCredential" (
  "id"            TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "kind"          TEXT NOT NULL,
  "ciphertext"    TEXT NOT NULL,
  "keyContext"    TEXT NOT NULL DEFAULT '',
  "meta"          JSONB NOT NULL DEFAULT '{}',
  "expiresAt"     TIMESTAMP(3),
  "refreshAfter"  TIMESTAMP(3),
  "rotatedAt"     TIMESTAMP(3),
  "rotatedFrom"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationCredential_integrationId_kind_key"
  ON "IntegrationCredential"("integrationId", "kind");
CREATE INDEX "IntegrationCredential_integrationId_idx"
  ON "IntegrationCredential"("integrationId");
CREATE INDEX "IntegrationCredential_expiresAt_idx"
  ON "IntegrationCredential"("expiresAt");

ALTER TABLE "IntegrationCredential"
  ADD CONSTRAINT "IntegrationCredential_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "Integration"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;


CREATE TABLE "IntegrationSyncState" (
  "id"            TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "resourceId"    TEXT NOT NULL,
  "cursor"        TEXT,
  "fullSyncAt"    TIMESTAMP(3),
  "lastRunAt"     TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastErrorAt"   TIMESTAMP(3),
  "lastError"     TEXT,
  "recordsTotal"  INTEGER NOT NULL DEFAULT 0,
  "recordsLast"   INTEGER NOT NULL DEFAULT 0,
  "status"        TEXT NOT NULL DEFAULT 'idle',
  "schedule"      TEXT,
  "enabled"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "IntegrationSyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationSyncState_integrationId_resourceId_key"
  ON "IntegrationSyncState"("integrationId", "resourceId");
CREATE INDEX "IntegrationSyncState_integrationId_idx"
  ON "IntegrationSyncState"("integrationId");
CREATE INDEX "IntegrationSyncState_status_idx"
  ON "IntegrationSyncState"("status");

ALTER TABLE "IntegrationSyncState"
  ADD CONSTRAINT "IntegrationSyncState_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "Integration"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;


CREATE TABLE "IntegrationEvent" (
  "id"             TEXT NOT NULL,
  "integrationId"  TEXT NOT NULL,
  "direction"      TEXT NOT NULL,
  "type"           TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'pending',
  "payload"        JSONB NOT NULL DEFAULT '{}',
  "headers"        JSONB NOT NULL DEFAULT '{}',
  "signatureValid" BOOLEAN,
  "externalId"     TEXT,
  "attemptCount"   INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt"  TIMESTAMP(3),
  "lastError"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationEvent_integrationId_externalId_key"
  ON "IntegrationEvent"("integrationId", "externalId")
  WHERE "externalId" IS NOT NULL;
CREATE INDEX "IntegrationEvent_integrationId_idx"
  ON "IntegrationEvent"("integrationId");
CREATE INDEX "IntegrationEvent_direction_status_idx"
  ON "IntegrationEvent"("direction", "status");
CREATE INDEX "IntegrationEvent_createdAt_idx"
  ON "IntegrationEvent"("createdAt");

ALTER TABLE "IntegrationEvent"
  ADD CONSTRAINT "IntegrationEvent_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "Integration"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;


CREATE TABLE "IntegrationRun" (
  "id"             TEXT NOT NULL,
  "integrationId"  TEXT NOT NULL,
  "actionId"       TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'pending',
  "invokedBy"      TEXT NOT NULL DEFAULT 'user',
  "agentSessionId" TEXT,
  "userId"         TEXT,
  "input"          JSONB NOT NULL DEFAULT '{}',
  "output"         JSONB,
  "error"          TEXT,
  "httpStatus"     INTEGER,
  "durationMs"     INTEGER,
  "idempotencyKey" TEXT,
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"    TIMESTAMP(3),

  CONSTRAINT "IntegrationRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationRun_integrationId_idempotencyKey_key"
  ON "IntegrationRun"("integrationId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;
CREATE INDEX "IntegrationRun_integrationId_idx"
  ON "IntegrationRun"("integrationId");
CREATE INDEX "IntegrationRun_status_idx"
  ON "IntegrationRun"("status");
CREATE INDEX "IntegrationRun_startedAt_idx"
  ON "IntegrationRun"("startedAt");

ALTER TABLE "IntegrationRun"
  ADD CONSTRAINT "IntegrationRun_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "Integration"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;


CREATE TABLE "ExternalRecord" (
  "id"            TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "resourceId"    TEXT NOT NULL,
  "externalId"    TEXT NOT NULL,
  "data"          JSONB NOT NULL DEFAULT '{}',
  "fingerprint"   TEXT NOT NULL DEFAULT '',
  "mappedTo"      TEXT,
  "fetchedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExternalRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalRecord_integrationId_resourceId_externalId_key"
  ON "ExternalRecord"("integrationId", "resourceId", "externalId");
CREATE INDEX "ExternalRecord_integrationId_idx"
  ON "ExternalRecord"("integrationId");
CREATE INDEX "ExternalRecord_mappedTo_idx"
  ON "ExternalRecord"("mappedTo");
CREATE INDEX "ExternalRecord_fetchedAt_idx"
  ON "ExternalRecord"("fetchedAt");

ALTER TABLE "ExternalRecord"
  ADD CONSTRAINT "ExternalRecord_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "Integration"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
