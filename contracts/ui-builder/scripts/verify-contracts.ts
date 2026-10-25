import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AnySchema } from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { canonicalSha256 } from '../src/canonical-json';
import { VektreUIDocumentV2Schema } from '../src/document';
import { HUDDocumentV1Schema, migrateHUDDocumentV1 } from '../src/migration';
import { validateVektreUIDocument } from '../src/validation';

const packageRoot = resolve(__dirname, '..');
const schemaDirectory = resolve(packageRoot, 'schemas');
const fixtureDirectory = resolve(packageRoot, 'fixtures');
const fixtureNames = [
  'combat-hud.json',
  'exploration-hud.json',
  'inventory-menu.json',
  'boss-overlay.json',
  'vr-wrist-ui.json',
] as const;

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  const schemaFiles = (await readdir(schemaDirectory))
    .filter((name) => name.endsWith('.schema.json'))
    .sort();
  assert(
    schemaFiles.length === 23,
    `Expected 23 schemas, got ${schemaFiles.length}`,
  );

  for (const schemaFile of schemaFiles) {
    const schema = (await readJson(
      resolve(schemaDirectory, schemaFile),
    )) as AnySchema;
    ajv.compile(schema);
  }

  const validateJsonSchema = ajv.getSchema(
    'https://schemas.vektre.dev/ui-builder/vektre-ui-document-v2.schema.json',
  );
  assert(validateJsonSchema, 'Vektre UI document JSON Schema was not compiled');
  const expectedHashes = (await readJson(
    resolve(fixtureDirectory, 'canonical-hashes.json'),
  )) as Record<string, string>;

  for (const fixtureName of fixtureNames) {
    const fixture = await readJson(resolve(fixtureDirectory, fixtureName));
    const document = VektreUIDocumentV2Schema.parse(fixture);
    const semanticIssues = validateVektreUIDocument(document);
    assert(
      semanticIssues.length === 0,
      `${fixtureName} has semantic issues: ${JSON.stringify(semanticIssues)}`,
    );
    assert(
      validateJsonSchema(fixture),
      `${fixtureName} fails Ajv: ${JSON.stringify(validateJsonSchema.errors)}`,
    );
    assert(
      canonicalSha256(fixture) === expectedHashes[fixtureName],
      `${fixtureName} canonical hash drifted; regenerate canonical-hashes.json`,
    );
  }

  const legacy = HUDDocumentV1Schema.parse(
    await readJson(resolve(fixtureDirectory, 'legacy-hud-v1.json')),
  );
  const migrated = migrateHUDDocumentV1(legacy);
  const migrationIssues = validateVektreUIDocument(migrated);
  assert(
    migrationIssues.length === 0,
    `HUD v1 migration has semantic issues: ${JSON.stringify(migrationIssues)}`,
  );
}

void main();
