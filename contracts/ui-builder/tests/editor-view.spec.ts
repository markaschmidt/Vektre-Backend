import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EditorViewStateSchema,
  VektreUIDocumentV2Schema,
  buildEditorViewState,
  canonicalSha256,
  editorViewIssues,
  type VektreUIDocumentV2,
} from '../src/index';

const combat = VektreUIDocumentV2Schema.parse(
  JSON.parse(
    readFileSync(
      resolve(__dirname, '../fixtures/combat-hud.json'),
      'utf8',
    ),
  ),
) as VektreUIDocumentV2;

const documentHash = canonicalSha256(combat);

describe('editor view state', () => {
  it('includes in-view records and selected ancestors', () => {
    const view = buildEditorViewState({
      document: combat,
      documentHash,
      documentRevision: 'revision-1',
      fieldOfView: {
        screenId: 'combat',
        surfaceId: 'main_surface',
        visibleRect: { x: 1000, y: 900, width: 500, height: 180 },
        zoom: 1.25,
        selectedIds: ['player_health'],
      },
    });
    expect(EditorViewStateSchema.parse(view).documentHash).toBe(documentHash);
    const ids = view.elements.map((element) => element.id);
    expect(ids).toContain('right_ability_bar');
    expect(ids).toContain('player_health');
    expect(ids).toContain('vitals_group');
    expect(ids).not.toContain('left_ability_bar');
    const health = view.elements.find((element) => element.id === 'player_health');
    expect(health?.resolvedStyle?.id).toBe('resource_bar');
    expect(health?.bindings.map((binding) => binding.id)).toEqual([
      'player_health_value',
    ]);
    expect(view.fieldOfView.zoom).toBe(1.25);
  });

  it('rejects a submission whose element record disagrees with the frozen GUI', () => {
    const view = buildEditorViewState({
      document: combat,
      documentHash,
      documentRevision: 'revision-1',
    });
    const health = view.elements.find((element) => element.id === 'player_health');
    expect(health).toBeDefined();
    const issues = editorViewIssues({
      document: combat,
      documentHash,
      submission: {
        schemaVersion: 1,
        documentHash,
        fieldOfView: view.fieldOfView,
        elements: [
          {
            ...health!,
            node: {
              ...health!.node,
              name: 'Renamed Health',
            },
          },
        ],
      },
    });
    expect(issues.map((issue) => issue.code)).toContain('element_mismatch');
  });
});
