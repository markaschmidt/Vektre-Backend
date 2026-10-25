import { z } from 'zod';
import {
  IsoDateTimeSchema,
  OpaqueIdSchema,
  SemanticIdSchema,
  Sha256Schema,
  SourceVisibilitySchema,
  VisibilitySchema,
} from './common.js';
import { EditorViewSubmissionSchema } from './editor-view.js';

export const SourceKindSchema = z.enum([
  'message',
  'document',
  'screen',
  'group',
  'component',
  'block',
  'asset',
  'storyboard',
  'comment',
  'artifact',
  'memory',
]);

export const SourceCitationSchema = z.strictObject({
  sourceId: OpaqueIdSchema,
  sourceKind: SourceKindSchema,
  contentHash: Sha256Schema,
  visibility: SourceVisibilitySchema,
  label: z.string().min(1).max(256).nullish(),
  locator: z.string().min(1).max(1024).nullish(),
  excerpt: z.string().max(2048).nullish(),
});

export const TextMessagePartSchema = z.strictObject({
  type: z.literal('text'),
  text: z.string().min(1).max(50000),
});

export const ImageAssetMessagePartSchema = z.strictObject({
  type: z.literal('image_asset'),
  assetId: OpaqueIdSchema,
  contentHash: Sha256Schema.optional(),
  purpose: z.enum(['reference', 'style', 'content', 'comparison']).optional(),
});

export const UIReferenceMessagePartSchema = z.strictObject({
  type: z.literal('ui_reference'),
  referenceKind: z.enum(['screen', 'group', 'component', 'block']),
  semanticId: SemanticIdSchema,
  documentHash: Sha256Schema.optional(),
});

export const StoryboardMessagePartSchema = z.strictObject({
  type: z.literal('storyboard_section'),
  documentId: OpaqueIdSchema,
  headerBlockId: OpaqueIdSchema,
  contentHash: Sha256Schema,
});

export const CommentMessagePartSchema = z.strictObject({
  type: z.literal('comment'),
  commentId: OpaqueIdSchema,
});

export const ProjectArtifactMessagePartSchema = z.strictObject({
  type: z.literal('project_artifact'),
  artifactKind: z.enum(['document', 'file', 'asset', 'lore', 'repository']),
  artifactId: OpaqueIdSchema,
  contentHash: Sha256Schema.optional(),
});

export const EditorViewMessagePartSchema = z.strictObject({
  type: z.literal('editor_view'),
  view: EditorViewSubmissionSchema,
});

export const MessagePartSchema = z.discriminatedUnion('type', [
  TextMessagePartSchema,
  ImageAssetMessagePartSchema,
  UIReferenceMessagePartSchema,
  StoryboardMessagePartSchema,
  CommentMessagePartSchema,
  ProjectArtifactMessagePartSchema,
  EditorViewMessagePartSchema,
]);

export const ThreadSummarySchema = z.strictObject({
  threadId: OpaqueIdSchema,
  projectId: OpaqueIdSchema,
  documentId: OpaqueIdSchema.optional(),
  ownerUserId: OpaqueIdSchema,
  title: z.string().min(1).max(256),
  visibility: VisibilitySchema,
  status: z.enum(['active', 'archived']),
  lastMessageAt: IsoDateTimeSchema.optional(),
});

export const UIAIMessageSchema = z.strictObject({
  messageId: OpaqueIdSchema,
  threadId: OpaqueIdSchema,
  actorId: OpaqueIdSchema,
  role: z.enum(['user', 'assistant', 'tool', 'system']),
  visibility: VisibilitySchema,
  parts: z.array(MessagePartSchema).min(1).max(128),
  citations: z.array(SourceCitationSchema).max(256),
  createdAt: IsoDateTimeSchema,
});

export type MessagePart = z.infer<typeof MessagePartSchema>;
export type SourceCitation = z.infer<typeof SourceCitationSchema>;
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;
export type UIAIMessage = z.infer<typeof UIAIMessageSchema>;
