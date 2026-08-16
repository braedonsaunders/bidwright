-- Unify the three takeoff link tables onto Pickup + PickupLink.
--
-- Every takeoff quantity becomes a Pickup row tagged by sourceKind
-- ("annotation" | "cad-entity" | "model" | "scan-measurement" |
-- "scan-segment"); PickupLink becomes the only junction into
-- WorksheetItem. Existing DwgEntityLink and ModelTakeoffLink rows are
-- backfilled into Pickup + PickupLink pairs (derivedQuantity is preserved
-- exactly, so worksheet totals do not move), then the two legacy tables
-- are dropped.

-- 1. New Pickup columns ----------------------------------------------------

ALTER TABLE "Pickup"
  ADD COLUMN "sourceKind" TEXT NOT NULL DEFAULT 'annotation',
  ADD COLUMN "cadEntityId" TEXT,
  ADD COLUMN "cadEntityType" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "cadLayer" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "modelId" TEXT,
  ADD COLUMN "modelElementId" TEXT,
  ADD COLUMN "modelQuantityId" TEXT,
  ADD COLUMN "selection" JSONB NOT NULL DEFAULT '{}';

CREATE INDEX "Pickup_sourceKind_idx" ON "Pickup"("sourceKind");
CREATE INDEX "Pickup_modelId_idx" ON "Pickup"("modelId");
CREATE INDEX "Pickup_modelElementId_idx" ON "Pickup"("modelElementId");
CREATE INDEX "Pickup_cadEntityId_idx" ON "Pickup"("cadEntityId");

ALTER TABLE "Pickup"
  ADD CONSTRAINT "Pickup_modelId_fkey"
  FOREIGN KEY ("modelId") REFERENCES "ModelAsset"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Backfill CAD entity links --------------------------------------------
-- One Pickup per distinct (documentId, entityId); the old table was unique
-- on (documentId, entityId, worksheetItemId) so links migrate 1:1.

INSERT INTO "Pickup" (
  "id", "projectId", "documentId", "pageNumber", "annotationType", "label",
  "color", "lineThickness", "visible", "groupName", "points", "measurement",
  "metadata", "sourceKind", "cadEntityId", "cadEntityType", "cadLayer",
  "selection", "createdAt", "updatedAt"
)
SELECT DISTINCT ON (d."documentId", d."entityId")
  'takeoff-cadmig-' || md5(d."documentId" || '|' || d."entityId"),
  d."projectId", d."documentId", 0, 'cad-entity',
  TRIM(COALESCE(NULLIF(d."entityType", ''), 'entity') || ' ' || d."entityId"),
  '#3b82f6', 4, true, '',
  '[]'::jsonb,
  jsonb_build_object('value', d."quantity"),
  jsonb_build_object('source', 'cad', 'method', 'cad-entity-link', 'measuredBy', 'agent'),
  'cad-entity', d."entityId", d."entityType", d."layer", d."selection",
  d."createdAt", d."updatedAt"
FROM "DwgEntityLink" d
ORDER BY d."documentId", d."entityId", d."updatedAt" DESC;

INSERT INTO "PickupLink" (
  "id", "projectId", "pickupId", "worksheetItemId", "quantityField",
  "multiplier", "derivedQuantity", "createdAt", "updatedAt"
)
SELECT
  'tlink-cadmig-' || md5(d."id"),
  d."projectId",
  'takeoff-cadmig-' || md5(d."documentId" || '|' || d."entityId"),
  d."worksheetItemId", 'value', d."multiplier", d."derivedQuantity",
  d."createdAt", d."updatedAt"
FROM "DwgEntityLink" d
ON CONFLICT ("pickupId", "worksheetItemId") DO NOTHING;

-- 3. Backfill model (BIM) takeoff links -----------------------------------
-- One Pickup per distinct (modelId, elementId, quantityId). The old table
-- had no uniqueness, so duplicate (source, item) pairs are collapsed into a
-- single PickupLink whose derivedQuantity is the sum (multiplier resets to 1
-- for collapsed rows so the total is preserved).

INSERT INTO "Pickup" (
  "id", "projectId", "documentId", "pageNumber", "annotationType", "label",
  "color", "lineThickness", "visible", "groupName", "points", "measurement",
  "metadata", "sourceKind", "modelId", "modelElementId", "modelQuantityId",
  "selection", "createdAt", "updatedAt"
)
SELECT DISTINCT ON (m."modelId", COALESCE(m."modelElementId", ''), COALESCE(m."modelQuantityId", ''))
  'takeoff-modmig-' || md5(m."modelId" || '|' || COALESCE(m."modelElementId", '') || '|' || COALESCE(m."modelQuantityId", '')),
  m."projectId", 'model-' || m."modelId", 0, 'model-element',
  COALESCE(NULLIF(e."name", ''), NULLIF(e."elementClass", ''), 'Model element'),
  '#8b5cf6', 4, true, '',
  '[]'::jsonb,
  '{}'::jsonb,
  jsonb_build_object('source', 'bim', 'method', 'model-takeoff-link', 'measuredBy', 'agent'),
  'model', m."modelId", m."modelElementId", m."modelQuantityId", m."selection",
  m."createdAt", m."updatedAt"
FROM "ModelTakeoffLink" m
LEFT JOIN "ModelElement" e ON e."id" = m."modelElementId"
ORDER BY m."modelId", COALESCE(m."modelElementId", ''), COALESCE(m."modelQuantityId", ''), m."updatedAt" DESC;

-- Measurement JSON per model pickup: one key per quantityField used by its
-- links (raw value = derivedQuantity / multiplier), plus a "value" fallback
-- from the most recent link so collapsed 'value'-field links stay resyncable.
UPDATE "Pickup" p
SET "measurement" = agg."fields" || jsonb_build_object('value', agg."latestRaw")
FROM (
  SELECT
    'takeoff-modmig-' || md5(m."modelId" || '|' || COALESCE(m."modelElementId", '') || '|' || COALESCE(m."modelQuantityId", '')) AS "pid",
    jsonb_object_agg(
      COALESCE(NULLIF(m."quantityField", ''), 'value'),
      CASE WHEN m."multiplier" IS NULL OR m."multiplier" = 0
        THEN m."derivedQuantity"
        ELSE m."derivedQuantity" / m."multiplier"
      END
    ) AS "fields",
    (ARRAY_AGG(
      CASE WHEN m."multiplier" IS NULL OR m."multiplier" = 0
        THEN m."derivedQuantity"
        ELSE m."derivedQuantity" / m."multiplier"
      END ORDER BY m."updatedAt" DESC
    ))[1] AS "latestRaw"
  FROM "ModelTakeoffLink" m
  GROUP BY 1
) agg
WHERE p."id" = agg."pid";

INSERT INTO "PickupLink" (
  "id", "projectId", "pickupId", "worksheetItemId", "quantityField",
  "multiplier", "derivedQuantity", "createdAt", "updatedAt"
)
SELECT
  'tlink-modmig-' || md5(g."pid" || '|' || g."worksheetItemId"),
  g."projectId", g."pid", g."worksheetItemId",
  CASE WHEN g."cnt" = 1 THEN g."qf" ELSE 'value' END,
  CASE WHEN g."cnt" = 1 THEN g."mult" ELSE 1 END,
  g."derived", g."createdAt", g."updatedAt"
FROM (
  SELECT
    'takeoff-modmig-' || md5(m."modelId" || '|' || COALESCE(m."modelElementId", '') || '|' || COALESCE(m."modelQuantityId", '')) AS "pid",
    MIN(m."projectId") AS "projectId",
    m."worksheetItemId",
    COUNT(*) AS "cnt",
    MAX(COALESCE(NULLIF(m."quantityField", ''), 'value')) AS "qf",
    MAX(m."multiplier") AS "mult",
    SUM(m."derivedQuantity") AS "derived",
    MIN(m."createdAt") AS "createdAt",
    MAX(m."updatedAt") AS "updatedAt"
  FROM "ModelTakeoffLink" m
  GROUP BY 1, m."worksheetItemId"
) g
ON CONFLICT ("pickupId", "worksheetItemId") DO NOTHING;

-- 4. Drop the legacy tables ------------------------------------------------

DROP TABLE "DwgEntityLink";
DROP TABLE "ModelTakeoffLink";
