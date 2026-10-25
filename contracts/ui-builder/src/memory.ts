import { z } from 'zod';
import {
  IsoDateTimeSchema,
  JsonValueSchema,
  OpaqueIdSchema,
  SemanticIdSchema,
  VisibilitySchema,
} from './common.js';

export const DesignMemoryKindSchema = z.enum([
  'lore',
  'aesthetic',
  'constraint',
  'decision',
  'rejected_direction',
  'interaction_rule',
  'terminology',
]);

export const DesignMemoryScopeSchema = z.enum([
  'organization',
  'project',
  'document',
  'screen',
  'block',
  'group',
  'component',
]);

export const DesignMemoryStatusSchema = z.enum([
  'proposed',
  'accepted',
  'rejected',
  'superseded',
]);

export const DesignMemoryProvenanceSchema = z.strictObject({
  sourceKind: z.enum([
    'message',
    'comment',
    'run',
    'user',
    'memory',
    'thread',
    'migration',
  ]),
  sourceId: OpaqueIdSchema,
  actorId: OpaqueIdSchema.optional(),
  documentRevision: z.string().min(1).max(256).optional(),
});

export const DesignMemoryRecordSchema = z.strictObject({
  memoryId: OpaqueIdSchema,
  projectId: OpaqueIdSchema,
  documentId: OpaqueIdSchema.optional(),
  kind: DesignMemoryKindSchema,
  scope: DesignMemoryScopeSchema,
  scopeId: SemanticIdSchema.optional(),
  text: z.string().min(1).max(10000),
  structuredValue: JsonValueSchema.optional(),
  status: DesignMemoryStatusSchema,
  visibility: VisibilitySchema,
  ownerUserId: OpaqueIdSchema.optional(),
  pinned: z.boolean(),
  effectiveRevision: z.string().min(1).max(256).optional(),
  reviewedByUserId: OpaqueIdSchema.optional(),
  reviewedAt: IsoDateTimeSchema.optional(),
  supersededByMemoryId: OpaqueIdSchema.optional(),
  provenance: DesignMemoryProvenanceSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const DesignMemoryProposalSchema = z.strictObject({
  proposalId: OpaqueIdSchema,
  kind: DesignMemoryKindSchema,
  scope: DesignMemoryScopeSchema,
  scopeId: SemanticIdSchema.optional(),
  text: z.string().min(1).max(10000),
  structuredValue: JsonValueSchema.optional(),
  visibility: VisibilitySchema,
  rationale: z.string().min(1).max(4096),
  sourceMessageId: OpaqueIdSchema.optional(),
});

export type DesignMemoryRecord = z.infer<typeof DesignMemoryRecordSchema>;
export type DesignMemoryProposal = z.infer<typeof DesignMemoryProposalSchema>;
export type DesignMemoryKind = z.infer<typeof DesignMemoryKindSchema>;
export type DesignMemoryScope = z.infer<typeof DesignMemoryScopeSchema>;
export type DesignMemoryStatus = z.infer<typeof DesignMemoryStatusSchema>;
