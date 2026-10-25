import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import {
  ApprovedDocumentPathSchema,
  DocumentPatchProposalSchema,
  HUDDocumentV1Schema,
  SourceCitationSchema,
  VektreUIDocumentV2Schema,
  canonicalJson,
  canonicalSha256,
  migrateHUDDocumentV1,
  validateDocumentPatchProposal,
  validateVektreUIDocument,
  type VektreUIDocumentV2,
} from '../src/index';

const packageRoot = resolve(__dirname, '..');
const fixtureNames = [
  'combat-hud.json',
  'exploration-hud.json',
  'inventory-menu.json',
  'boss-overlay.json',
  'vr-wrist-ui.json',
] as const;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function readFixture(name: string): unknown {
  return readJson(resolve(packageRoot, 'fixtures', name));
}

describe('Vektre UI contract compatibility', () => {
  it.each(fixtureNames)('validates %s in Zod and Ajv 2020', (fixtureName) => {
    const fixture = readFixture(fixtureName);
    const parsed = VektreUIDocumentV2Schema.parse(fixture);
    expect(validateVektreUIDocument(parsed)).toEqual([]);

    const schema = readJson(
      resolve(packageRoot, 'schemas', 'vektre-ui-document-v2.schema.json'),
    );
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    expect({ valid: validate(fixture), errors: validate.errors }).toEqual({
      valid: true,
      errors: null,
    });
  });

  it('keeps reusable block instance overrides independent', () => {
    const document = VektreUIDocumentV2Schema.parse(
      readFixture('combat-hud.json'),
    );
    const left = document.blockInstances.left_ability_bar;
    const right = document.blockInstances.right_ability_bar;

    expect(left.definitionId).toBe(right.definitionId);
    expect(left.overrides).not.toEqual(right.overrides);
    expect(
      document.blockDefinitions.ability_bar.nodes.ability_root,
    ).toBeDefined();
  });

  it('migrates HUDDocument v1 without dropping legacy content', () => {
    const legacy = HUDDocumentV1Schema.parse(readFixture('legacy-hud-v1.json'));
    const migrated = migrateHUDDocumentV1(legacy);

    expect(VektreUIDocumentV2Schema.parse(migrated)).toEqual(migrated);
    expect(validateVektreUIDocument(migrated)).toEqual([]);
    expect(
      migrated.components.legacy_health.metadata?.legacyNode,
    ).toMatchObject({
      binding: 'player.health',
      content: { label: 'HEALTH' },
      states: { critical: { threshold: 0.2 } },
    });
    expect(migrated.screens.main_screen.metadata?.legacyMetadata).toMatchObject(
      {
        customLore: 'The crimson bar represents vitality.',
      },
    );
  });

  it('reports cycles, duplicate semantic IDs, and dangling references', () => {
    const base = VektreUIDocumentV2Schema.parse(readFixture('combat-hud.json'));
    const invalid = structuredClone(base);
    invalid.groups.vitals_group.parentId = 'vitals_group';
    invalid.components.player_health.id = 'vitals_group';
    invalid.components.player_health.assetIds = ['missing_asset'];
    invalid.blockDefinitions.ability_bar.nodes.ability_root.parentId =
      'ability_slot';
    invalid.blockDefinitions.ability_bar.nodes.ability_slot.children = [
      'ability_root',
    ];

    expect(
      validateVektreUIDocument(invalid).map((issue) => issue.code),
    ).toEqual(
      expect.arrayContaining([
        'duplicate_semantic_id',
        'parent_cycle',
        'block_parent_cycle',
        'dangling_reference',
        'record_key_id_mismatch',
      ]),
    );
  });

  it('restricts patch roots and requires mutation preconditions', () => {
    expect(ApprovedDocumentPathSchema.safeParse('/secrets/key').success).toBe(
      false,
    );
    const patch = DocumentPatchProposalSchema.parse({
      schemaVersion: 1,
      proposalId: 'proposal-1',
      runId: 'run-1',
      baseDocumentHash: 'a'.repeat(64),
      baseRevision: 'revision-1',
      intent: 'Increase the health bar width',
      targetedIds: ['player_health'],
      targetedPaths: ['/components/player_health/layout/size/width'],
      operations: [
        {
          op: 'replace',
          path: '/components/player_health/layout/size/width',
          value: 480,
        },
      ],
      generatedAssetIds: [],
      intentionallyPreservedPaths: [],
      conflicts: [],
    });

    expect(validateDocumentPatchProposal(patch)).toEqual([
      expect.objectContaining({ code: 'missing_patch_precondition' }),
    ]);
  });

  it('canonicalizes deterministically before hashing', () => {
    const left = { z: 1, nested: { b: true, a: 'value' }, a: [3, 2, 1] };
    const right = { a: [3, 2, 1], nested: { a: 'value', b: true }, z: 1 };

    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(canonicalSha256(left)).toMatch(/^[a-f0-9]{64}$/);
    expect(canonicalSha256(left)).toBe(canonicalSha256(right));
  });

  it('accepts JSON null for optional citation fields', () => {
    expect(
      SourceCitationSchema.parse({
        sourceId: 'doc-1',
        sourceKind: 'document',
        contentHash: 'a'.repeat(64),
        visibility: 'shared',
        label: null,
        locator: null,
        excerpt: null,
      }),
    ).toEqual({
      sourceId: 'doc-1',
      sourceKind: 'document',
      contentHash: 'a'.repeat(64),
      visibility: 'shared',
      label: null,
      locator: null,
      excerpt: null,
    });
  });
});

function compileTimeContract(document: VektreUIDocumentV2): void {
  void document;
}

void compileTimeContract;
