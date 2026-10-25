import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  AgentRunSchema,
  AgentStageRequestSchema,
  AgentStageResultSchema,
  AgentStepSchema,
  AssistantTurnSchema,
  MatchReviewSetSchema,
  RunReviewRecordSchema,
  RunReviewRequestSchema,
  SolverInputSchema,
  SolverResultSchema,
  ValidationIssueSchema,
} from '../src/agent';
import { UIBlockDefinitionSchema, UIBlockInstanceSchema } from '../src/blocks';
import { ContextManifestSchema } from '../src/context';
import { VektreUIDocumentV2Schema } from '../src/document';
import {
  DesignMemoryProposalSchema,
  DesignMemoryRecordSchema,
} from '../src/memory';
import {
  MessagePartSchema,
  SourceCitationSchema,
  ThreadSummarySchema,
  UIAIMessageSchema,
} from '../src/messages';
import { EditorViewStateSchema } from '../src/editor-view';
import { HUDDocumentV1Schema } from '../src/migration';
import {
  DocumentPatchProposalSchema,
  PatchConflictSchema,
} from '../src/patches';
import { ModelInvocationTelemetrySchema } from '../src/telemetry';

const packageRoot = resolve(__dirname, '..');
const outputDirectory = resolve(packageRoot, 'schemas');
const schemaBaseUri = 'https://schemas.vektre.dev/ui-builder';

const roots: Record<string, { title: string; schema: z.ZodType }> = {
  'vektre-ui-document-v2': {
    title: 'Vektre UI Document v2',
    schema: VektreUIDocumentV2Schema,
  },
  'ui-block-definition': {
    title: 'UI Block Definition',
    schema: UIBlockDefinitionSchema,
  },
  'ui-block-instance': {
    title: 'UI Block Instance',
    schema: UIBlockInstanceSchema,
  },
  'message-part': {
    title: 'Multimodal Message Part',
    schema: MessagePartSchema,
  },
  'thread-summary': {
    title: 'UI AI Thread Summary',
    schema: ThreadSummarySchema,
  },
  'ui-ai-message': { title: 'UI AI Message', schema: UIAIMessageSchema },
  'source-citation': { title: 'Source Citation', schema: SourceCitationSchema },
  'design-memory-record': {
    title: 'Design Memory Record',
    schema: DesignMemoryRecordSchema,
  },
  'design-memory-proposal': {
    title: 'Design Memory Proposal',
    schema: DesignMemoryProposalSchema,
  },
  'context-manifest': {
    title: 'Context Manifest',
    schema: ContextManifestSchema,
  },
  'assistant-turn': { title: 'Assistant Turn', schema: AssistantTurnSchema },
  'agent-run': { title: 'Agent Run', schema: AgentRunSchema },
  'agent-step': { title: 'Agent Step', schema: AgentStepSchema },
  'agent-stage-request': {
    title: 'Agent Stage Request',
    schema: AgentStageRequestSchema,
  },
  'agent-stage-result': {
    title: 'Agent Stage Result',
    schema: AgentStageResultSchema,
  },
  'solver-input': { title: 'Solver Input', schema: SolverInputSchema },
  'solver-result': { title: 'Solver Result', schema: SolverResultSchema },
  'match-review-set': {
    title: 'Match Review Set',
    schema: MatchReviewSetSchema,
  },
  'validation-issue': {
    title: 'Validation Issue',
    schema: ValidationIssueSchema,
  },
  'patch-conflict': { title: 'Patch Conflict', schema: PatchConflictSchema },
  'document-patch-proposal': {
    title: 'Document Patch Proposal',
    schema: DocumentPatchProposalSchema,
  },
  'model-invocation-telemetry': {
    title: 'Model Invocation Telemetry',
    schema: ModelInvocationTelemetrySchema,
  },
  'hud-document-v1': {
    title: 'Legacy HUD Document v1',
    schema: HUDDocumentV1Schema,
  },
  'editor-view-state': {
    title: 'Editor field of view and element states',
    schema: EditorViewStateSchema,
  },
  'run-review-request': {
    title: 'UI Agent Run Review Request',
    schema: RunReviewRequestSchema,
  },
  'run-review-record': {
    title: 'UI Agent Run Review Record',
    schema: RunReviewRecordSchema,
  },
};

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortObject(child)]),
    );
  }
  return value;
}

async function main(): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });

  for (const [name, root] of Object.entries(roots)) {
    const generated = z.toJSONSchema(root.schema, {
      target: 'draft-2020-12',
      io: 'input',
      reused: 'ref',
      cycles: 'ref',
      unrepresentable: 'throw',
    });
    const schema = sortObject({
      ...generated,
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: `${schemaBaseUri}/${name}.schema.json`,
      title: root.title,
      $comment: 'Vektre contract version 1',
    });
    const target = resolve(outputDirectory, `${name}.schema.json`);
    await writeFile(target, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
  }
}

void main();
