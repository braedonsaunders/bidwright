-- Quote.title is the single customer-facing quote title. Older builds edited
-- QuoteRevision.title from Setup while lists and headers read Quote/Project,
-- allowing the three copies to diverge. Preserve the current revision's
-- operator-entered title, then make every legacy projection agree with it.

UPDATE "Quote" AS quote
SET
  "title" = revision."title",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "QuoteRevision" AS revision
WHERE
  revision."id" = quote."currentRevisionId"
  AND btrim(revision."title") <> ''
  AND quote."title" IS DISTINCT FROM revision."title";

UPDATE "QuoteRevision" AS revision
SET
  "title" = quote."title",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Quote" AS quote
WHERE
  quote."id" = revision."quoteId"
  AND revision."title" IS DISTINCT FROM quote."title";

UPDATE "Project" AS project
SET
  "name" = quote."title",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Quote" AS quote
WHERE
  quote."projectId" = project."id"
  AND project."isStandalone" = TRUE
  AND btrim(quote."title") <> ''
  AND project."name" IS DISTINCT FROM quote."title";
