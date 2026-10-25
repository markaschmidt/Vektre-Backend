import {
  EditorViewSubmissionSchema,
  type ContextManifest,
  type EditorViewSubmission,
  type MessagePart,
} from '@markaschmidt/ui-builder-contracts';
import type {
  UiAgentStageArtifactRow,
  UiAiMessageRow,
} from './models/ui-agent.model.js';

const NODE_SOURCE_KINDS = new Set([
  'component',
  'group',
  'block',
  'screen',
]);

export function editorSubmissionFromMessage(
  message: UiAiMessageRow | null | undefined,
): EditorViewSubmission | undefined {
  const part = message?.parts.find(
    (item): item is Extract<MessagePart, { type: 'editor_view' }> =>
      item.type === 'editor_view',
  );
  return part?.view;
}

export function editorSubmissionFromArtifacts(
  artifacts: UiAgentStageArtifactRow[],
): EditorViewSubmission | undefined {
  for (const artifact of [...artifacts].reverse()) {
    if (artifact.artifactKind !== 'review' || !isRecord(artifact.payload)) {
      continue;
    }
    if (artifact.payload.type !== 'editor_view_submission') continue;
    const parsed = EditorViewSubmissionSchema.safeParse(artifact.payload.view);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

export function selectionHintIds(
  artifacts: UiAgentStageArtifactRow[],
): string[] {
  const ids: string[] = [];
  for (const artifact of artifacts) {
    if (artifact.artifactKind !== 'review' || !isRecord(artifact.payload)) {
      continue;
    }
    if (artifact.payload.type !== 'selection_hints') continue;
    if (!Array.isArray(artifact.payload.ids)) continue;
    for (const id of artifact.payload.ids) {
      if (typeof id === 'string') ids.push(id);
    }
  }
  return ids;
}

export function referencedElementIds(
  message: UiAiMessageRow | null | undefined,
  manifest: ContextManifest | null | undefined,
): string[] {
  const ids: string[] = [];
  for (const part of message?.parts ?? []) {
    if (part.type === 'ui_reference') ids.push(part.semanticId);
  }
  for (const section of manifest?.sections ?? []) {
    if (section.name !== 'retrieval' && section.name !== 'explicit_references') {
      continue;
    }
    for (const source of section.sources) {
      if (NODE_SOURCE_KINDS.has(source.sourceKind)) ids.push(source.sourceId);
    }
  }
  return ids;
}

export function isModelFacingArtifact(
  artifact: UiAgentStageArtifactRow,
): boolean {
  if (
    artifact.artifactKind === 'stage_output' ||
    artifact.artifactKind === 'asset_result'
  ) {
    return true;
  }
  if (artifact.artifactKind !== 'review' || !isRecord(artifact.payload)) {
    return false;
  }
  return (
    artifact.payload.type !== 'editor_view_submission' &&
    artifact.payload.type !== 'selection_hints'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
