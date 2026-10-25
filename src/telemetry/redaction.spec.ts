import { redactAttributes, redactTelemetryValue, sanitizeErrorCategory } from './redaction.js';
import { ProviderError } from '../integrations/provider-error.model.js';

describe('telemetry redaction', () => {
  it('strips prompts, comments, signed URLs, and secrets by default', () => {
    const redacted = redactAttributes({
      prompt: 'Build a combat HUD with a health bar',
      comment: 'please move the minimap',
      messages: [{ role: 'user', content: 'secret design notes' }],
      authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb',
      signedUrl: 'https://example.supabase.co/storage/v1/object/sign/bucket/file?token=abc',
      image: 'data:image/png;base64,AAAA',
      'vektre.run_id': 'run-1',
      'vektre.schema_version': '1',
    });
    expect(JSON.stringify(redacted)).not.toMatch(/health bar/i);
    expect(JSON.stringify(redacted)).not.toMatch(/minimap/i);
    expect(JSON.stringify(redacted)).not.toMatch(/secret design/i);
    expect(JSON.stringify(redacted)).not.toMatch(/eyJhbGciOi/);
    expect(JSON.stringify(redacted)).not.toMatch(/token=abc/);
    expect(JSON.stringify(redacted)).not.toMatch(/data:image/);
    expect(redacted['vektre.run_id']).toBe('run-1');
    expect(redacted['vektre.schema_version']).toBe('1');
    expect(redacted.prompt).toEqual(
      expect.objectContaining({ redacted: true, kind: 'content' }),
    );
  });

  it('classifies provider failures without leaking bodies', () => {
    expect(
      sanitizeErrorCategory(ProviderError.retryable('openai', 'HTTP 429: quota', 429)),
    ).toBe('rate_limited');
    const category = sanitizeErrorCategory(
      new Error('timeout after 120000ms prompt=do not leak'),
    );
    expect(category).toBe('timeout');
    expect(category).not.toContain('prompt');
  });

  it('hashes content instead of storing it', () => {
    const value = redactTelemetryValue('keep this private', 'prompt');
    expect(value).toEqual(
      expect.objectContaining({
        redacted: true,
        kind: 'content',
        hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });
});
