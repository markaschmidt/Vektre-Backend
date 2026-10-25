import { readFileSync } from 'node:fs';
import {
  JsonObjectSchema,
  VektreUIDocumentV2Schema,
  writeVektreUiDocument,
  type JsonValue,
  type VektreUIDocumentV2,
} from '@markaschmidt/ui-builder-contracts';
import * as Y from 'yjs';
import {
  UiSnapshotValidationError,
  extractUiDocumentFromYjs,
} from './ui-document-extractor.js';

describe('extractUiDocumentFromYjs', () => {
  it('decodes, validates, hashes, and extracts deterministic digests', () => {
    const document = fixture();
    const first = extractUiDocumentFromYjs({
      bytes: encode(document),
      projectId: 'project-1',
      documentId: 'document-1',
    });
    const second = extractUiDocumentFromYjs({
      bytes: encode(document),
      projectId: 'project-1',
      documentId: 'document-1',
    });

    expect(second.documentHash).toBe(first.documentHash);
    expect(first.layoutFingerprints).toHaveProperty('player_health');
    expect(first.retrievalDocuments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKind: 'component',
          sourceId: 'player_health',
        }),
      ]),
    );
  });

  it('calculates collaborative changes against the accepted baseline', () => {
    const original = extractUiDocumentFromYjs({
      bytes: encode(fixture()),
      projectId: 'project-1',
      documentId: 'document-1',
    });
    const changedDocument = structuredClone(fixture());
    const component = changedDocument.components.player_health;
    if (!component) throw new Error('fixture component missing');
    component.layout = {
      ...component.layout,
      position: { x: 120, y: 240 },
    };

    const changed = extractUiDocumentFromYjs({
      bytes: encode(changedDocument),
      projectId: 'project-1',
      documentId: 'document-1',
      baselineDigest: original.structuralDigest,
    });
    const digest = JsonObjectSchema.parse(changed.structuralDigest);
    const delta = JsonObjectSchema.parse(digest.humanDelta);
    expect(delta.changed).toEqual(['player_health']);
    expect(delta.added).toEqual([]);
    expect(delta.deleted).toEqual([]);
  });

  it('returns validation issues instead of repairing an invalid snapshot', () => {
    const invalid: JsonValue = { schemaVersion: 2, documentKind: 'hud' };
    expect(() =>
      extractUiDocumentFromYjs({
        bytes: encode(invalid),
        projectId: 'project-1',
        documentId: 'document-1',
      }),
    ).toThrow(UiSnapshotValidationError);
  });
});

function fixture(): VektreUIDocumentV2 {
  return VektreUIDocumentV2Schema.parse(
    JSON.parse(
      readFileSync('contracts/ui-builder/fixtures/combat-hud.json', 'utf8'),
    ),
  );
}

function encode(value: JsonValue): Uint8Array {
  const yDocument = new Y.Doc();
  const parsed = VektreUIDocumentV2Schema.safeParse(value);
  if (parsed.success) {
    writeVektreUiDocument(yDocument, parsed.data);
  } else {
    const root = yDocument.getMap('root');
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [key, entry] of Object.entries(value)) {
        root.set(key, entry);
      }
    }
  }
  return Y.encodeStateAsUpdate(yDocument);
}
