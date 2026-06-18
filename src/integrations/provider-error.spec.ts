import { classifyHttpStatus, ProviderError } from './provider-error.model.js';

describe('ProviderError', () => {
  it('creates a retryable error', () => {
    const err = ProviderError.retryable('openai', 'rate limited', 429);
    expect(err.retryable).toBe(true);
    expect(err.provider).toBe('openai');
    expect(err.statusCode).toBe(429);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toBeInstanceOf(Error);
  });

  it('creates a permanent error', () => {
    const err = ProviderError.permanent('replicate', 'not found', 404);
    expect(err.retryable).toBe(false);
    expect(err.provider).toBe('replicate');
    expect(err.statusCode).toBe(404);
  });
});

describe('classifyHttpStatus', () => {
  it('classifies 429 as retryable', () => {
    const err = classifyHttpStatus('openai', 429, 'too many requests');
    expect(err.retryable).toBe(true);
    expect(err.statusCode).toBe(429);
  });

  it('classifies 500 as retryable', () => {
    const err = classifyHttpStatus('replicate', 500, 'internal error');
    expect(err.retryable).toBe(true);
  });

  it('classifies 503 as retryable', () => {
    const err = classifyHttpStatus('notion', 503, 'service unavailable');
    expect(err.retryable).toBe(true);
  });

  it('classifies 400 as permanent', () => {
    const err = classifyHttpStatus('openai', 400, 'bad request');
    expect(err.retryable).toBe(false);
  });

  it('classifies 401 as permanent', () => {
    const err = classifyHttpStatus('google-drive', 401, 'unauthorized');
    expect(err.retryable).toBe(false);
  });

  it('classifies 404 as permanent', () => {
    const err = classifyHttpStatus('notion', 404, 'not found');
    expect(err.retryable).toBe(false);
  });
});
