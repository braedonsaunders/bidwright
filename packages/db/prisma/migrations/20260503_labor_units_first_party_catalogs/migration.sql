UPDATE "LaborUnitLibrary"
SET "isTemplate" = false,
    "sourceTemplateId" = NULL
WHERE "organizationId" IS NULL
  AND "isTemplate" = true;
