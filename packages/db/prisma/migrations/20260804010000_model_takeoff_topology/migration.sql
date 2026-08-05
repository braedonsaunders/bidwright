-- Persisted takeoff graph, detected system/run hierarchy, reusable recipes,
-- and revision-safe estimator overrides.
CREATE TABLE "ModelElementConnection" (
  "id" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "fromElementId" TEXT NOT NULL,
  "toElementId" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'physical',
  "source" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModelElementConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelTakeoffGroup" (
  "id" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "parentId" TEXT,
  "signature" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "trade" TEXT NOT NULL DEFAULT 'general',
  "source" TEXT NOT NULL DEFAULT 'inferred',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "measurementType" TEXT NOT NULL DEFAULT 'count',
  "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "unit" TEXT NOT NULL DEFAULT '',
  "warnings" JSONB NOT NULL DEFAULT '[]',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModelTakeoffGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelTakeoffGroupMember" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "elementId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'member',
  "ordinal" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModelTakeoffGroupMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelTakeoffRecipe" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "modelId" TEXT,
  "name" TEXT NOT NULL,
  "trade" TEXT NOT NULL DEFAULT 'general',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "rules" JSONB NOT NULL DEFAULT '{}',
  "createdBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModelTakeoffRecipe_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelTakeoffOverride" (
  "id" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "targetSignature" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModelTakeoffOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModelElementConnection_modelId_signature_key" ON "ModelElementConnection"("modelId", "signature");
CREATE INDEX "ModelElementConnection_modelId_idx" ON "ModelElementConnection"("modelId");
CREATE INDEX "ModelElementConnection_fromElementId_idx" ON "ModelElementConnection"("fromElementId");
CREATE INDEX "ModelElementConnection_toElementId_idx" ON "ModelElementConnection"("toElementId");
CREATE UNIQUE INDEX "ModelTakeoffGroup_modelId_signature_key" ON "ModelTakeoffGroup"("modelId", "signature");
CREATE INDEX "ModelTakeoffGroup_modelId_kind_idx" ON "ModelTakeoffGroup"("modelId", "kind");
CREATE INDEX "ModelTakeoffGroup_parentId_idx" ON "ModelTakeoffGroup"("parentId");
CREATE INDEX "ModelTakeoffGroup_trade_idx" ON "ModelTakeoffGroup"("trade");
CREATE UNIQUE INDEX "ModelTakeoffGroupMember_groupId_elementId_key" ON "ModelTakeoffGroupMember"("groupId", "elementId");
CREATE INDEX "ModelTakeoffGroupMember_groupId_idx" ON "ModelTakeoffGroupMember"("groupId");
CREATE INDEX "ModelTakeoffGroupMember_elementId_idx" ON "ModelTakeoffGroupMember"("elementId");
CREATE INDEX "ModelTakeoffRecipe_projectId_idx" ON "ModelTakeoffRecipe"("projectId");
CREATE INDEX "ModelTakeoffRecipe_modelId_idx" ON "ModelTakeoffRecipe"("modelId");
CREATE UNIQUE INDEX "ModelTakeoffRecipe_projectId_modelId_name_key" ON "ModelTakeoffRecipe"("projectId", "modelId", "name");
CREATE INDEX "ModelTakeoffOverride_modelId_idx" ON "ModelTakeoffOverride"("modelId");
CREATE INDEX "ModelTakeoffOverride_modelId_targetSignature_idx" ON "ModelTakeoffOverride"("modelId", "targetSignature");

ALTER TABLE "ModelElementConnection" ADD CONSTRAINT "ModelElementConnection_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ModelAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelElementConnection" ADD CONSTRAINT "ModelElementConnection_fromElementId_fkey" FOREIGN KEY ("fromElementId") REFERENCES "ModelElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelElementConnection" ADD CONSTRAINT "ModelElementConnection_toElementId_fkey" FOREIGN KEY ("toElementId") REFERENCES "ModelElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelTakeoffGroup" ADD CONSTRAINT "ModelTakeoffGroup_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ModelAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelTakeoffGroup" ADD CONSTRAINT "ModelTakeoffGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ModelTakeoffGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelTakeoffGroupMember" ADD CONSTRAINT "ModelTakeoffGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ModelTakeoffGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelTakeoffGroupMember" ADD CONSTRAINT "ModelTakeoffGroupMember_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "ModelElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelTakeoffRecipe" ADD CONSTRAINT "ModelTakeoffRecipe_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelTakeoffRecipe" ADD CONSTRAINT "ModelTakeoffRecipe_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ModelAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelTakeoffOverride" ADD CONSTRAINT "ModelTakeoffOverride_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ModelAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
