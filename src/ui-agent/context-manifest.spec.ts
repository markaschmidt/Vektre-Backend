import { BadRequestException } from '@nestjs/common';
import type { ContextManifest } from '@markaschmidt/ui-builder-contracts';
import { normalizeContextManifest } from './context-manifest.js';

describe('normalizeContextManifest', () => {
  it('normalizes section and source ordering before hashing', () => {
    const first = normalizeContextManifest(manifest(false), 'shared');
    const secondInput = manifest(false);
    secondInput.sections.reverse();
    secondInput.sections[1]?.sources.reverse();
    const second = normalizeContextManifest(secondInput, 'shared');

    expect(first.manifest.sections.map((section) => section.name)).toEqual([
      'explicit_references',
      'retrieval',
    ]);
    expect(
      first.manifest.sections[0].sources.map((source) => source.rank),
    ).toEqual([0, 1]);
    expect(second.manifestHash).toBe(first.manifestHash);
  });

  it('rejects private sources in a shared run', () => {
    expect(() => normalizeContextManifest(manifest(true), 'shared')).toThrow(
      BadRequestException,
    );
  });

  it('recomputes exact token estimates and enforces budgets', () => {
    const input = manifest(false);
    input.estimatedTokens = 999;
    const normalized = normalizeContextManifest(input, 'shared');
    expect(normalized.manifest.estimatedTokens).toBe(23);

    input.sections[0].tokenBudget = 1;
    expect(() => normalizeContextManifest(input, 'shared')).toThrow(
      BadRequestException,
    );
  });
});

function manifest(privateSource: boolean): ContextManifest {
  const hash = 'a'.repeat(64);
  return {
    schemaVersion: 1,
    manifestId: 'manifest-1',
    runId: 'run-1',
    projectId: 'project-1',
    documentId: 'document-1',
    threadId: 'thread-1',
    actorId: 'user-1',
    documentRevision: 'revision-1',
    documentHash: hash,
    modelPresetId: 'balanced',
    totalTokenBudget: 100,
    estimatedTokens: 0,
    generatedAt: '2026-08-20T00:00:00.000Z',
    sections: [
      {
        name: 'retrieval',
        tokenBudget: 50,
        estimatedTokens: 0,
        sources: [source('vector-1', 'vector', 0, 8, privateSource)],
      },
      {
        name: 'explicit_references',
        tokenBudget: 50,
        estimatedTokens: 0,
        sources: [
          source('asset-2', 'explicit_reference', 1, 5, false),
          source('asset-1', 'explicit_reference', 0, 10, false),
        ],
      },
    ],
  };
}

function source(
  sourceId: string,
  selectionReason: 'vector' | 'explicit_reference',
  rank: number,
  estimatedTokens: number,
  privateSource: boolean,
): ContextManifest['sections'][number]['sources'][number] {
  const contentHash = 'b'.repeat(64);
  const visibility = privateSource ? 'private' : 'shared';
  return {
    sourceId,
    sourceKind: 'asset',
    contentHash,
    visibility,
    selectionReason,
    rank,
    estimatedTokens,
    content: { sourceId },
    citation: {
      sourceId,
      sourceKind: 'asset',
      contentHash,
      visibility,
    },
    truncated: false,
  };
}
