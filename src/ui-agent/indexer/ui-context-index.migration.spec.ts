import { readFileSync } from 'node:fs';

describe('UI context index migration', () => {
  const sql = readFileSync(
    'supabase/migrations/20260820010000_ui_context_indexer.sql',
    'utf8',
  );

  it('stores durable index attempts without replacing valid revisions', () => {
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS ui_context_index_attempt',
    );
    expect(sql).toContain('snapshot_id TEXT NOT NULL UNIQUE');
    expect(sql).toContain("status IN ('valid', 'invalid', 'failed')");
    expect(sql).toContain('validation_issues_json JSONB');
  });

  it('provides project and visibility filtered full-text retrieval', () => {
    expect(sql).toContain('search_vector TSVECTOR GENERATED ALWAYS');
    expect(sql).toContain('USING GIN (search_vector)');
    expect(sql).toContain('search_ui_retrieval_documents');
    expect(sql).toContain("rd.visibility = 'shared'");
    expect(sql).toContain('rd.owner_user_id = p_actor_user_id');
  });

  it('does not require pgvector for canonical retrieval', () => {
    expect(sql).not.toContain('CREATE EXTENSION');
    expect(sql).toContain(
      "IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
    );
    expect(sql).toContain('search_ui_artifact_embeddings_pgvector');
  });
});
