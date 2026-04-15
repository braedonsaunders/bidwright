-- Runs automatically on first Postgres init (docker-entrypoint-initdb.d)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS vector_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  project_id TEXT,
  scope TEXT NOT NULL DEFAULT 'project',
  embedding vector(1024) NOT NULL,
  text TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vector_records_org ON vector_records (organization_id);
CREATE INDEX IF NOT EXISTS idx_vector_records_project ON vector_records (project_id);
CREATE INDEX IF NOT EXISTS idx_vector_records_scope ON vector_records (scope);
CREATE INDEX IF NOT EXISTS idx_vector_records_document ON vector_records (document_id);
CREATE INDEX IF NOT EXISTS idx_vector_records_embedding ON vector_records USING hnsw (embedding vector_cosine_ops);
