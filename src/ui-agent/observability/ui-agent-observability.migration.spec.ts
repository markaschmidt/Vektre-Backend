import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('UI-agent observability migration', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20260820030000_ui_agent_observability.sql'),
    'utf8',
  );

  it('makes stage and provider request ids unique for ledger upserts', () => {
    expect(sql).toContain('idx_ui_model_invocation_stage_execution');
    expect(sql).toContain('idx_generation_usage_provider_request');
    expect(sql).toContain('provider_cost_usd');
    expect(sql).toContain('price_table_version');
  });

  it('stores quality metrics and telemetry policy without content columns', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ui_agent_quality_event');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS project_telemetry_policy');
    expect(sql).not.toContain('prompt_text');
    expect(sql).not.toContain('signed_url');
    expect(sql).toContain('content_traces BOOLEAN NOT NULL DEFAULT FALSE');
  });

  it('creates operational views for lag, stalls, and unreconciled activity', () => {
    expect(sql).toContain('ui_ops_stalled_stages');
    expect(sql).toContain('ui_ops_index_lag');
    expect(sql).toContain('ui_ops_unreconciled_activities');
    expect(sql).toContain('ui_ops_quality_rollup');
  });
});
