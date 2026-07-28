-- Consolidate drawing extraction onto the single tenant-configurable Gemini
-- provider. This is a data migration, not a runtime compatibility shim:
-- application code only understands "gemini" and "none" after this release.

UPDATE "OrganizationSettings"
SET "integrations" =
  (
    "integrations"
      - 'landingAiDrawingExtractionEnabled'
      - 'landingAiApiKey'
      - 'landingAiEndpoint'
      - 'landingAiParseModel'
      - 'landingAiExtractModel'
      - 'geminiProModel'
      - 'geminiFlashModel'
  )
  || CASE
    WHEN "integrations"->>'drawingExtractionProvider' = 'geminiFlash' THEN
      jsonb_build_object(
        'drawingExtractionProvider', 'gemini',
        'drawingExtractionModel', COALESCE(NULLIF("integrations"->>'geminiFlashModel', ''), 'gemini-2.5-flash')
      )
    WHEN "integrations"->>'drawingExtractionProvider' IN ('geminiPro', 'landingAi')
      OR lower(COALESCE("integrations"->>'landingAiDrawingExtractionEnabled', '')) IN ('true', '1', 'yes', 'on') THEN
      jsonb_build_object(
        'drawingExtractionProvider', 'gemini',
        'drawingExtractionModel', COALESCE(NULLIF("integrations"->>'geminiProModel', ''), 'gemini-2.5-pro')
      )
    ELSE '{}'::jsonb
  END
WHERE
  "integrations" ?| ARRAY[
    'landingAiDrawingExtractionEnabled',
    'landingAiApiKey',
    'landingAiEndpoint',
    'landingAiParseModel',
    'landingAiExtractModel',
    'geminiProModel',
    'geminiFlashModel'
  ]
  OR "integrations"->>'drawingExtractionProvider' IN ('geminiPro', 'geminiFlash', 'landingAi');

UPDATE "UserSettings"
SET "integrations" =
  (
    "integrations"
      - 'landingAiDrawingExtractionEnabled'
      - 'landingAiApiKey'
      - 'landingAiEndpoint'
      - 'landingAiParseModel'
      - 'landingAiExtractModel'
      - 'geminiProModel'
      - 'geminiFlashModel'
  )
  || CASE
    WHEN "integrations"->>'drawingExtractionProvider' = 'geminiFlash' THEN
      jsonb_build_object(
        'drawingExtractionProvider', 'gemini',
        'drawingExtractionModel', COALESCE(NULLIF("integrations"->>'geminiFlashModel', ''), 'gemini-2.5-flash')
      )
    WHEN "integrations"->>'drawingExtractionProvider' IN ('geminiPro', 'landingAi')
      OR lower(COALESCE("integrations"->>'landingAiDrawingExtractionEnabled', '')) IN ('true', '1', 'yes', 'on') THEN
      jsonb_build_object(
        'drawingExtractionProvider', 'gemini',
        'drawingExtractionModel', COALESCE(NULLIF("integrations"->>'geminiProModel', ''), 'gemini-2.5-pro')
      )
    ELSE '{}'::jsonb
  END
WHERE
  "integrations" ?| ARRAY[
    'landingAiDrawingExtractionEnabled',
    'landingAiApiKey',
    'landingAiEndpoint',
    'landingAiParseModel',
    'landingAiExtractModel',
    'geminiProModel',
    'geminiFlashModel'
  ]
  OR "integrations"->>'drawingExtractionProvider' IN ('geminiPro', 'geminiFlash', 'landingAi');

UPDATE "SuperAdmin"
SET "integrations" =
  (
    "integrations"
      - 'landingAiDrawingExtractionEnabled'
      - 'landingAiApiKey'
      - 'landingAiEndpoint'
      - 'landingAiParseModel'
      - 'landingAiExtractModel'
      - 'geminiProModel'
      - 'geminiFlashModel'
  )
  || CASE
    WHEN "integrations"->>'drawingExtractionProvider' = 'geminiFlash' THEN
      jsonb_build_object(
        'drawingExtractionProvider', 'gemini',
        'drawingExtractionModel', COALESCE(NULLIF("integrations"->>'geminiFlashModel', ''), 'gemini-2.5-flash')
      )
    WHEN "integrations"->>'drawingExtractionProvider' IN ('geminiPro', 'landingAi')
      OR lower(COALESCE("integrations"->>'landingAiDrawingExtractionEnabled', '')) IN ('true', '1', 'yes', 'on') THEN
      jsonb_build_object(
        'drawingExtractionProvider', 'gemini',
        'drawingExtractionModel', COALESCE(NULLIF("integrations"->>'geminiProModel', ''), 'gemini-2.5-pro')
      )
    ELSE '{}'::jsonb
  END
WHERE
  "integrations" ?| ARRAY[
    'landingAiDrawingExtractionEnabled',
    'landingAiApiKey',
    'landingAiEndpoint',
    'landingAiParseModel',
    'landingAiExtractModel',
    'geminiProModel',
    'geminiFlashModel'
  ]
  OR "integrations"->>'drawingExtractionProvider' IN ('geminiPro', 'geminiFlash', 'landingAi');
