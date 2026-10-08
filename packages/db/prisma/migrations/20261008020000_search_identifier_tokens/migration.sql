-- Preserve numeric identifiers such as grades, split letter-case transitions only.
DROP INDEX IF EXISTS "LaborUnit_reference_search_idx";
CREATE INDEX IF NOT EXISTS "LaborUnit_reference_search_idx" ON "LaborUnit" USING GIN ((
  setweight(to_tsvector('english', regexp_replace(coalesce("name", '') || ' ' || coalesce("code", ''), '([[:lower:]])([[:upper:]])', '\1 \2', 'g')), 'A') ||
  setweight(to_tsvector('english', coalesce("className", '') || ' ' || coalesce("subClassName", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("description", '')), 'B') ||
  setweight(to_tsvector('english', coalesce("category", '') || ' ' || coalesce("discipline", '')), 'C')
));
DROP INDEX IF EXISTS "DatasetRow_reference_search_idx";
CREATE INDEX IF NOT EXISTS "DatasetRow_reference_search_idx" ON "DatasetRow" USING GIN (to_tsvector('english', regexp_replace("data"::text, '([[:lower:]])([[:upper:]])', '\1 \2', 'g')));
