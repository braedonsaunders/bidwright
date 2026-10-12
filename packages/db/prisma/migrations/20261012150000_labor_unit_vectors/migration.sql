-- Labour has a separate ANN index: pgvector 0.6 filters HNSW candidates after
-- scanning, so adding labour records to the knowledge index would starve books.
DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE TABLE IF NOT EXISTS labor_unit_vectors (
      unit_id TEXT PRIMARY KEY REFERENCES "LaborUnit"(id) ON DELETE CASCADE,
      library_id TEXT NOT NULL REFERENCES "LaborUnitLibrary"(id) ON DELETE CASCADE,
      namespace TEXT NOT NULL,
      provider_key TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      text TEXT NOT NULL,
      embedding vector NOT NULL,
      unit_updated_at TIMESTAMP(3) NOT NULL,
      library_updated_at TIMESTAMP(3) NOT NULL,
      CHECK (dimensions > 0 AND vector_dims(embedding) = dimensions)
    );
    CREATE INDEX IF NOT EXISTS idx_labor_vectors_library ON labor_unit_vectors (library_id);
    CREATE INDEX IF NOT EXISTS idx_labor_vectors_model ON labor_unit_vectors (namespace, provider_key, model, dimensions);
    -- The deployed provider uses 1024 dimensions. Other dimensions use exact search.
    CREATE INDEX IF NOT EXISTS idx_labor_vectors_hnsw_1024 ON labor_unit_vectors
      USING hnsw ((embedding::vector(1024)) vector_cosine_ops) WHERE dimensions = 1024;

    -- Cover all write paths, including imports; cascades also cover org deletion.
    EXECUTE $function$
      CREATE OR REPLACE FUNCTION invalidate_labor_unit_vectors() RETURNS trigger AS $body$
      BEGIN
        IF TG_TABLE_NAME = 'LaborUnit' THEN
          DELETE FROM labor_unit_vectors WHERE unit_id = OLD.id;
        ELSE
          DELETE FROM labor_unit_vectors WHERE library_id = OLD.id;
        END IF;
        RETURN NEW;
      END;
      $body$ LANGUAGE plpgsql
    $function$;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'labor_unit_vectors_invalidate_unit' AND tgrelid = '"LaborUnit"'::regclass) THEN
      CREATE TRIGGER labor_unit_vectors_invalidate_unit AFTER UPDATE ON "LaborUnit"
        FOR EACH ROW EXECUTE FUNCTION invalidate_labor_unit_vectors();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'labor_unit_vectors_invalidate_library' AND tgrelid = '"LaborUnitLibrary"'::regclass) THEN
      CREATE TRIGGER labor_unit_vectors_invalidate_library AFTER UPDATE ON "LaborUnitLibrary"
        FOR EACH ROW EXECUTE FUNCTION invalidate_labor_unit_vectors();
    END IF;
  END IF;
END;
$migration$;
