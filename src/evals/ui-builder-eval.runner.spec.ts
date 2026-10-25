import { runBlockingEvals, runEvalCase, loadEvalCases } from './ui-builder-eval.runner.js';

describe('UI-builder golden evals', () => {
  it('loads versioned datasets scoped by document kind and theme', () => {
    const cases = loadEvalCases();
    expect(cases.length).toBeGreaterThan(8);
    expect(cases.some((item) => item.theme === 'combat')).toBe(true);
    expect(cases.some((item) => item.theme === 'vr_wrist_spatial')).toBe(true);
    expect(cases.some((item) => item.kind === 'model_quality' && !item.blocking)).toBe(
      true,
    );
    expect(cases.filter((item) => item.kind === 'vlm_review').every((item) => !item.blocking)).toBe(
      true,
    );
  });

  it('passes deterministic contract, patch-preservation, and solver cases', () => {
    const results = runBlockingEvals();
    const failed = results.filter((item) => item.status === 'failed');
    expect(failed).toEqual([]);
    expect(results.some((item) => item.kind === 'contract')).toBe(true);
    expect(results.some((item) => item.kind === 'patch_preservation')).toBe(true);
    expect(results.some((item) => item.kind === 'solver')).toBe(true);
  });

  it('skips non-blocking model quality and VLM review without treating them as truth', () => {
    const skipped = loadEvalCases()
      .filter((item) => item.kind === 'model_quality' || item.kind === 'vlm_review')
      .map(runEvalCase);
    expect(skipped.every((item) => item.status === 'skipped')).toBe(true);
    expect(skipped.every((item) => item.errors.length === 0)).toBe(true);
  });
});
