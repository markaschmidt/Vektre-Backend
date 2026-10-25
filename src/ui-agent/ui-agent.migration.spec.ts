import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('UI-agent persistence migration', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260820000000_ui_agent_memory_context.sql',
    ),
    'utf8',
  );

  const tables = [
    'ui_ai_thread',
    'ui_ai_message',
    'ui_design_memory',
    'ui_document_revision',
    'ui_ai_baseline',
    'ui_agent_run',
    'ui_agent_step',
    'ui_context_manifest',
    'ui_artifact_relation',
    'ui_artifact_embedding',
    'ui_model_invocation',
  ];

  it.each(tables)('creates and enables RLS for %s', (table) => {
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  });

  it('keeps authenticated access read-only and visibility scoped', () => {
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]*FOR (INSERT|UPDATE|DELETE)/);
    expect(sql).toContain(
      "visibility = 'shared' OR owner_user_id = auth.uid()::text",
    );
    expect(sql).toContain(
      'public.is_project_member(project_id, auth.uid()::text)',
    );
  });

  it('provides atomic private publication, deletion, and superseding', () => {
    expect(sql).toContain('publish_private_ui_ai_thread');
    expect(sql).toContain('delete_private_ui_ai_thread');
    expect(sql).toContain('supersede_ui_design_memory');
    expect(sql).toContain('purge_expired_ui_agent_content');
    expect(sql).toContain('GRANT EXECUTE');
    expect(sql).toContain('TO service_role');
  });

  it('stores only durable references for agent steps', () => {
    expect(sql).toContain('input_ref TEXT');
    expect(sql).toContain('output_ref TEXT');
    expect(sql).not.toContain('prompt_text');
    expect(sql).not.toContain('signed_url');
  });

  it('does not make optional pgvector support a migration prerequisite', () => {
    expect(sql).not.toContain('CREATE EXTENSION');
    expect(sql).toContain('embedding_json JSONB NOT NULL');
    expect(sql).toContain("jsonb_typeof(embedding_json) = 'array'");
  });
});
