import { z } from 'zod';
import {
  JsonValueSchema,
  OpaqueIdSchema,
  SemanticIdSchema,
  Sha256Schema,
} from './common.js';

export const APPROVED_PATCH_ROOTS = [
  'metadata',
  'platformProfiles',
  'spatialProfiles',
  'screens',
  'surfaces',
  'flows',
  'groups',
  'components',
  'blockDefinitions',
  'blockInstances',
  'designTokens',
  'styles',
  'assets',
  'bindings',
  'states',
  'interactions',
  'visibilityRules',
  'animations',
  'constraints',
  'provenance',
] as const;

const approvedRoots = APPROVED_PATCH_ROOTS.join('|');
const jsonPointerSegment = '(?:[^/~]|~[01])+';

export const ApprovedDocumentPathSchema = z
  .string()
  .max(2048)
  .regex(
    new RegExp(`^/(?:${approvedRoots})(?:/${jsonPointerSegment})*$`),
    'Patch path is outside approved document roots',
  );

export const AddOperationSchema = z.strictObject({
  op: z.literal('add'),
  path: ApprovedDocumentPathSchema,
  value: JsonValueSchema,
});

export const RemoveOperationSchema = z.strictObject({
  op: z.literal('remove'),
  path: ApprovedDocumentPathSchema,
});

export const ReplaceOperationSchema = z.strictObject({
  op: z.literal('replace'),
  path: ApprovedDocumentPathSchema,
  value: JsonValueSchema,
});

export const MoveOperationSchema = z.strictObject({
  op: z.literal('move'),
  from: ApprovedDocumentPathSchema,
  path: ApprovedDocumentPathSchema,
});

export const CopyOperationSchema = z.strictObject({
  op: z.literal('copy'),
  from: ApprovedDocumentPathSchema,
  path: ApprovedDocumentPathSchema,
});

export const TestOperationSchema = z.strictObject({
  op: z.literal('test'),
  path: ApprovedDocumentPathSchema,
  value: JsonValueSchema,
});

export const JsonPatchOperationSchema = z.discriminatedUnion('op', [
  AddOperationSchema,
  RemoveOperationSchema,
  ReplaceOperationSchema,
  MoveOperationSchema,
  CopyOperationSchema,
  TestOperationSchema,
]);

export const PatchConflictSchema = z.strictObject({
  path: ApprovedDocumentPathSchema,
  kind: z.enum([
    'test_failed',
    'human_changed',
    'target_deleted',
    'reference_missing',
    'schema_invalid',
  ]),
  baseValue: JsonValueSchema.optional(),
  liveValue: JsonValueSchema.optional(),
  proposedValue: JsonValueSchema.optional(),
  resolution: z.enum(['human_wins', 'ai_wins', 'manual']).optional(),
  message: z.string().min(1).max(2048),
});

export const DocumentPatchProposalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  proposalId: OpaqueIdSchema,
  runId: OpaqueIdSchema,
  activityId: OpaqueIdSchema.optional(),
  baseDocumentHash: Sha256Schema,
  baseRevision: z.string().min(1).max(256),
  intent: z.string().min(1).max(4096),
  targetedIds: z.array(SemanticIdSchema).max(1024),
  targetedPaths: z.array(ApprovedDocumentPathSchema).max(2048),
  operations: z.array(JsonPatchOperationSchema).min(1).max(4096),
  generatedAssetIds: z.array(OpaqueIdSchema).max(1024),
  intentionallyPreservedPaths: z.array(ApprovedDocumentPathSchema).max(4096),
  conflicts: z.array(PatchConflictSchema).max(4096),
});

export type JsonPatchOperation = z.infer<typeof JsonPatchOperationSchema>;
export type DocumentPatchProposal = z.infer<typeof DocumentPatchProposalSchema>;
export type PatchConflict = z.infer<typeof PatchConflictSchema>;
