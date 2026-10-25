import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('UI-agent durable transition migration', () => {
  const sql = [
    '20260820000000_ui_agent_memory_context.sql',
    '20260820020000_ui_agent_durable_transitions.sql',
  ]
    .map((name) =>
      readFileSync(join(process.cwd(), 'supabase/migrations', name), 'utf8'),
    )
    .join('\n');

  it('enforces one active mutating run and durable paid-call identity', () => {
    expect(sql).toContain('idx_ui_agent_run_one_mutating');
    expect(sql).toContain('idx_ui_agent_run_project_request');
    expect(sql).toContain('stage_execution_id TEXT NOT NULL UNIQUE');
    expect(sql).toContain('idempotency_key TEXT NOT NULL UNIQUE');
  });

  it('persists frozen stage artifacts and asset request resumptions', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ui_agent_stage_artifact');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ui_agent_asset_request');
    expect(sql).toContain('transition_ui_agent_run');
    expect(sql).toContain('complete_ui_agent_step');
  });
});
