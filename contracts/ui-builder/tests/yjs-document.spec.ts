import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Y from 'yjs';
import { VektreUIDocumentV2Schema } from '../src/document';
import { canonicalSha256 } from '../src/canonical-json';
import {
  readVektreUiDocument,
  writeVektreUiDocument,
} from '../src/yjs-document';

const packageRoot = resolve(__dirname, '..');

describe('contracts: VektreUIDocument Yjs bind', () => {
  it('round-trips the combat HUD fixture through nested maps', () => {
    const document = VektreUIDocumentV2Schema.parse(
      JSON.parse(
        readFileSync(
          resolve(packageRoot, 'fixtures', 'combat-hud.json'),
          'utf8',
        ),
      ),
    );
    const yDocument = new Y.Doc();
    writeVektreUiDocument(yDocument, document);
    expect(canonicalSha256(readVektreUiDocument(yDocument))).toBe(
      canonicalSha256(document),
    );
  });
});
