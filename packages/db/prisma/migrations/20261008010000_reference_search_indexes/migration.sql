-- Expression indexes avoid changing source rows or regenerating embeddings.
CREATE INDEX IF NOT EXISTS "LaborUnit_reference_search_idx" ON "LaborUnit" USING GIN ((
  setweight(to_tsvector('english', regexp_replace(coalesce("name", '') || ' ' || coalesce("code", ''), '([[:lower:][:digit:]])([[:upper:]])', '\1 \2', 'g')), 'A') ||
  setweight(to_tsvector('english', coalesce("className", '') || ' ' || coalesce("subClassName", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("description", '')), 'B') ||
  setweight(to_tsvector('english', coalesce("category", '') || ' ' || coalesce("discipline", '')), 'C')
));
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_reference_search_idx" ON "KnowledgeChunk" USING GIN ((
  setweight(to_tsvector('english', coalesce("sectionTitle", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("text", '')), 'B')
));
CREATE INDEX IF NOT EXISTS "KnowledgeDocumentChunk_reference_search_idx" ON "KnowledgeDocumentChunk" USING GIN ((
  setweight(to_tsvector('english', coalesce("sectionTitle", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("text", '')), 'B')
));
CREATE INDEX IF NOT EXISTS "DatasetRow_reference_search_idx" ON "DatasetRow" USING GIN (to_tsvector('english', regexp_replace("data"::text, '([[:lower:][:digit:]])([[:upper:]])', '\1 \2', 'g')));
CREATE INDEX IF NOT EXISTS "DatasetRow_dataset_order_idx" ON "DatasetRow" ("datasetId", "order", "id");
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_book_order_idx" ON "KnowledgeChunk" ("bookId", "order", "id");
