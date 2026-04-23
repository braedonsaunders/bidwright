CREATE TABLE "ModelAsset" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceDocumentId" TEXT,
  "fileNodeId" TEXT,
  "fileName" TEXT NOT NULL,
  "fileType" TEXT NOT NULL DEFAULT '',
  "format" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'indexed',
  "units" TEXT NOT NULL DEFAULT '',
  "checksum" TEXT NOT NULL DEFAULT '',
  "storagePath" TEXT NOT NULL DEFAULT '',
  "manifest" JSONB NOT NULL DEFAULT '{}',
  "bom" JSONB NOT NULL DEFAULT '[]',
  "elementStats" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ModelAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelElement" (
  "id" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL DEFAULT '',
  "parentId" TEXT,
  "name" TEXT NOT NULL DEFAULT '',
  "elementClass" TEXT NOT NULL DEFAULT '',
  "elementType" TEXT NOT NULL DEFAULT '',
  "system" TEXT NOT NULL DEFAULT '',
  "level" TEXT NOT NULL DEFAULT '',
  "material" TEXT NOT NULL DEFAULT '',
  "bbox" JSONB NOT NULL DEFAULT '{}',
  "geometryRef" TEXT NOT NULL DEFAULT '',
  "properties" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ModelElement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelQuantity" (
  "id" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "elementId" TEXT,
  "quantityType" TEXT NOT NULL,
  "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "unit" TEXT NOT NULL DEFAULT '',
  "method" TEXT NOT NULL DEFAULT 'computed',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ModelQuantity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelBom" (
  "id" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "grouping" TEXT NOT NULL DEFAULT 'native',
  "filters" JSONB NOT NULL DEFAULT '{}',
  "rows" JSONB NOT NULL DEFAULT '[]',
  "createdBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ModelBom_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelTakeoffLink" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "modelElementId" TEXT,
  "modelQuantityId" TEXT,
  "worksheetItemId" TEXT NOT NULL,
  "quantityField" TEXT NOT NULL DEFAULT 'quantity',
  "multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "derivedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ModelTakeoffLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelIssue" (
  "id" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "elementId" TEXT,
  "severity" TEXT NOT NULL DEFAULT 'info',
  "code" TEXT NOT NULL DEFAULT '',
  "message" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "resolved" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ModelIssue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelRevisionDiff" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "baseModelId" TEXT NOT NULL,
  "headModelId" TEXT NOT NULL,
  "summary" JSONB NOT NULL DEFAULT '{}',
  "rows" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ModelRevisionDiff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModelAsset_projectId_sourceDocumentId_key" ON "ModelAsset"("projectId", "sourceDocumentId");
CREATE UNIQUE INDEX "ModelAsset_projectId_fileNodeId_key" ON "ModelAsset"("projectId", "fileNodeId");
CREATE INDEX "ModelAsset_projectId_idx" ON "ModelAsset"("projectId");
CREATE INDEX "ModelAsset_sourceDocumentId_idx" ON "ModelAsset"("sourceDocumentId");
CREATE INDEX "ModelAsset_fileNodeId_idx" ON "ModelAsset"("fileNodeId");
CREATE INDEX "ModelElement_modelId_idx" ON "ModelElement"("modelId");
CREATE INDEX "ModelElement_modelId_externalId_idx" ON "ModelElement"("modelId", "externalId");
CREATE INDEX "ModelElement_elementClass_idx" ON "ModelElement"("elementClass");
CREATE INDEX "ModelQuantity_modelId_idx" ON "ModelQuantity"("modelId");
CREATE INDEX "ModelQuantity_elementId_idx" ON "ModelQuantity"("elementId");
CREATE INDEX "ModelQuantity_quantityType_idx" ON "ModelQuantity"("quantityType");
CREATE INDEX "ModelBom_modelId_idx" ON "ModelBom"("modelId");
CREATE INDEX "ModelTakeoffLink_projectId_idx" ON "ModelTakeoffLink"("projectId");
CREATE INDEX "ModelTakeoffLink_modelId_idx" ON "ModelTakeoffLink"("modelId");
CREATE INDEX "ModelTakeoffLink_modelElementId_idx" ON "ModelTakeoffLink"("modelElementId");
CREATE INDEX "ModelTakeoffLink_modelQuantityId_idx" ON "ModelTakeoffLink"("modelQuantityId");
CREATE INDEX "ModelTakeoffLink_worksheetItemId_idx" ON "ModelTakeoffLink"("worksheetItemId");
CREATE INDEX "ModelIssue_modelId_idx" ON "ModelIssue"("modelId");
CREATE INDEX "ModelIssue_elementId_idx" ON "ModelIssue"("elementId");
CREATE INDEX "ModelIssue_severity_idx" ON "ModelIssue"("severity");
CREATE INDEX "ModelRevisionDiff_projectId_idx" ON "ModelRevisionDiff"("projectId");
CREATE INDEX "ModelRevisionDiff_baseModelId_idx" ON "ModelRevisionDiff"("baseModelId");
CREATE INDEX "ModelRevisionDiff_headModelId_idx" ON "ModelRevisionDiff"("headModelId");

ALTER TABLE "ModelAsset"
ADD CONSTRAINT "ModelAsset_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelAsset"
ADD CONSTRAINT "ModelAsset_sourceDocumentId_fkey"
FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ModelAsset"
ADD CONSTRAINT "ModelAsset_fileNodeId_fkey"
FOREIGN KEY ("fileNodeId") REFERENCES "FileNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ModelElement"
ADD CONSTRAINT "ModelElement_modelId_fkey"
FOREIGN KEY ("modelId") REFERENCES "ModelAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelElement"
ADD CONSTRAINT "ModelElement_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "ModelElement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ModelQuantity"
ADD CONSTRAINT "ModelQuantity_modelId_fkey"
FOREIGN KEY ("modelId") REFERENCES "ModelAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelQuantity"
ADD CONSTRAINT "ModelQuantity_elementId_fkey"
FOREIGN KEY ("elementId") REFERENCES "ModelElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelBom"
ADD CONSTRAINT "ModelBom_modelId_fkey"
FOREIGN KEY ("modelId") REFERENCES "ModelAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelTakeoffLink"
ADD CONSTRAINT "ModelTakeoffLink_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelTakeoffLink"
ADD CONSTRAINT "ModelTakeoffLink_modelId_fkey"
FOREIGN KEY ("modelId") REFERENCES "ModelAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelTakeoffLink"
ADD CONSTRAINT "ModelTakeoffLink_modelElementId_fkey"
FOREIGN KEY ("modelElementId") REFERENCES "ModelElement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ModelTakeoffLink"
ADD CONSTRAINT "ModelTakeoffLink_modelQuantityId_fkey"
FOREIGN KEY ("modelQuantityId") REFERENCES "ModelQuantity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ModelTakeoffLink"
ADD CONSTRAINT "ModelTakeoffLink_worksheetItemId_fkey"
FOREIGN KEY ("worksheetItemId") REFERENCES "WorksheetItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelIssue"
ADD CONSTRAINT "ModelIssue_modelId_fkey"
FOREIGN KEY ("modelId") REFERENCES "ModelAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelIssue"
ADD CONSTRAINT "ModelIssue_elementId_fkey"
FOREIGN KEY ("elementId") REFERENCES "ModelElement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ModelRevisionDiff"
ADD CONSTRAINT "ModelRevisionDiff_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelRevisionDiff"
ADD CONSTRAINT "ModelRevisionDiff_baseModelId_fkey"
FOREIGN KEY ("baseModelId") REFERENCES "ModelAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModelRevisionDiff"
ADD CONSTRAINT "ModelRevisionDiff_headModelId_fkey"
FOREIGN KEY ("headModelId") REFERENCES "ModelAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
