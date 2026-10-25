import { readFileSync } from 'node:fs';
import {
  VektreUIDocumentV2Schema,
  canonicalSha256,
  emptyVektreUiDocument,
  forbiddenYjsContentIssues,
  isEmptyVektreUiDocument,
  layoutFingerprints,
  readVektreUiDocument,
  setRecordEntry,
  writeVektreUiDocument,
  type VektreUIDocumentV2,
} from '@markaschmidt/ui-builder-contracts';
import * as Y from 'yjs';

describe('VektreUIDocument Yjs nested maps', () => {
  it('round-trips a golden fixture without replacing record roots', () => {
    const document = fixture();
    const yDocument = new Y.Doc();
    writeVektreUiDocument(yDocument, document);
    const root = yDocument.getMap('root');
    const components = root.get('components');
    expect(components).toBeInstanceOf(Y.Map);
    const roundTrip = readVektreUiDocument(yDocument);
    expect(canonicalSha256(roundTrip)).toBe(canonicalSha256(document));
    expect(layoutFingerprints(roundTrip)).toHaveProperty('player_health');
  });

  it('lets two clients edit different nodes without clobbering each other', () => {
    const document = fixture();
    const clientA = new Y.Doc();
    writeVektreUiDocument(clientA, document);
    const clientB = new Y.Doc();
    Y.applyUpdate(clientB, Y.encodeStateAsUpdate(clientA));

    const moved = structuredClone(document.components.player_health);
    moved.layout = { ...moved.layout, position: { x: 120, y: 240 } };
    setRecordEntry(clientA, 'components', 'player_health', moved);

    const restyled = structuredClone(document.groups.vitals_group);
    restyled.name = 'Vitals Cluster';
    setRecordEntry(clientB, 'groups', 'vitals_group', restyled);

    Y.applyUpdate(clientA, Y.encodeStateAsUpdate(clientB, Y.encodeStateVector(clientA)));
    Y.applyUpdate(clientB, Y.encodeStateAsUpdate(clientA, Y.encodeStateVector(clientB)));

    const mergedA = readVektreUiDocument(clientA);
    const mergedB = readVektreUiDocument(clientB);
    expect(mergedA.components.player_health.layout.position).toEqual({
      x: 120,
      y: 240,
    });
    expect(mergedB.components.player_health.layout.position).toEqual({
      x: 120,
      y: 240,
    });
    expect(mergedA.groups.vitals_group.name).toBe('Vitals Cluster');
    expect(mergedB.groups.vitals_group.name).toBe('Vitals Cluster');
    expect(canonicalSha256(mergedA)).toBe(canonicalSha256(mergedB));
  });

  it('rejects signed URLs, worker URLs, and image base64 in Yjs state', () => {
    const document = fixture();
    document.assets.ornament = {
      id: 'ornament',
      assetId: 'data:image/png;base64,AAAA',
      role: 'icon',
      layer: 0,
    };
    expect(forbiddenYjsContentIssues(document).length).toBeGreaterThan(0);
    expect(() => writeVektreUiDocument(new Y.Doc(), document)).toThrow(
      /assetId/,
    );
  });

  it('treats an empty document as the only full-document apply target', () => {
    const empty = emptyVektreUiDocument({
      documentId: 'doc_empty',
      title: 'New HUD',
    });
    expect(isEmptyVektreUiDocument(empty)).toBe(true);
    expect(isEmptyVektreUiDocument(fixture())).toBe(false);
  });
});

function fixture(): VektreUIDocumentV2 {
  return structuredClone(
    VektreUIDocumentV2Schema.parse(
      JSON.parse(
        readFileSync('contracts/ui-builder/fixtures/combat-hud.json', 'utf8'),
      ),
    ),
  );
}
