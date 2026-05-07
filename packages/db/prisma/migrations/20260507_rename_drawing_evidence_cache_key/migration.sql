-- Rename SourceDocument.structuredData.landingAiDrawingEvidence -> drawingEvidence.
-- Adds a `provider: 'landingAi'` marker to existing records and sets schemaVersion=2 so
-- the new code path treats them identically to fresh provider results.
UPDATE "SourceDocument"
SET "structuredData" = (
  ("structuredData" - 'landingAiDrawingEvidence')
  || jsonb_build_object(
    'drawingEvidence',
    coalesce(
      "structuredData"->'landingAiDrawingEvidence'
        || jsonb_build_object(
          'schemaVersion', 2,
          'provider', 'landingAi'
        ),
      "structuredData"->'landingAiDrawingEvidence'
    )
  )
)
WHERE "structuredData" ? 'landingAiDrawingEvidence'
  AND "structuredData"->'landingAiDrawingEvidence' IS NOT NULL
  AND jsonb_typeof("structuredData"->'landingAiDrawingEvidence') = 'object';
