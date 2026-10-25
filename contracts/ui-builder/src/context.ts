import { z } from 'zod';
import {
  IsoDateTimeSchema,
  JsonValueSchema,
  OpaqueIdSchema,
  Sha256Schema,
  SourceVisibilitySchema,
} from './common.js';
import { SourceCitationSchema, SourceKindSchema } from './messages.js';

export const ContextSourceSchema = z.strictObject({
  sourceId: OpaqueIdSchema,
  sourceKind: SourceKindSchema,
  contentHash: Sha256Schema,
  visibility: SourceVisibilitySchema,
  selectionReason: z.enum([
    'live_document',
    'explicit_reference',
    'accepted_memory',
    'unresolved_comment',
    'recent_message',
    'summary',
    'human_delta',
    'artifact_relation',
    'full_text',
    'vector',
  ]),
  rank: z.number().int().nonnegative(),
  estimatedTokens: z.number().int().nonnegative(),
  content: JsonValueSchema,
  citation: SourceCitationSchema,
  truncated: z.boolean(),
});

export const ContextSectionSchema = z.strictObject({
  name: z.enum([
    'live_document',
    'explicit_references',
    'memory',
    'comments',
    'conversation',
    'human_delta',
    'artifacts',
    'retrieval',
  ]),
  tokenBudget: z.number().int().nonnegative(),
  estimatedTokens: z.number().int().nonnegative(),
  sources: z.array(ContextSourceSchema).max(4096),
});

export const ContextManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  manifestId: OpaqueIdSchema,
  runId: OpaqueIdSchema,
  projectId: OpaqueIdSchema,
  documentId: OpaqueIdSchema,
  threadId: OpaqueIdSchema,
  actorId: OpaqueIdSchema,
  documentRevision: z.string().min(1).max(256),
  documentHash: Sha256Schema,
  modelPresetId: OpaqueIdSchema,
  totalTokenBudget: z.number().int().positive(),
  estimatedTokens: z.number().int().nonnegative(),
  sections: z.array(ContextSectionSchema).min(1).max(32),
  generatedAt: IsoDateTimeSchema,
});

export type ContextManifest = z.infer<typeof ContextManifestSchema>;
