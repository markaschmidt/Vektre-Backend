import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('named collaboration snapshot migration', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260901000000_named_collaboration_snapshots.sql',
    ),
    'utf8',
  );

  it('adds nullable name and preview columns on the existing snapshot table', () => {
    expect(sql).toContain('ALTER TABLE collaboration_snapshot');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS name TEXT');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS preview_storage_ref TEXT');
    expect(sql).not.toContain('CREATE TABLE');
  });
});
