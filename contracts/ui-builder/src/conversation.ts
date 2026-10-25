import type { EditorViewSubmission } from './editor-view.js';
import {
  MessagePartSchema,
  type MessagePart,
  type SourceCitation,
  type ThreadSummary,
  type UIAIMessage,
} from './messages.js';

export const COMMENTS_ARE_NOT_AI_CHAT = true;
export const PRIVATE_APPLY_SHARES_TRANSCRIPT = false;

export interface ComposeUiMessageInput {
  text?: string;
  images?: Array<{
    assetId: string;
    contentHash?: string;
    purpose?: 'reference' | 'style' | 'content' | 'comparison';
  }>;
  uiReferences?: Array<{
    referenceKind: 'screen' | 'group' | 'component' | 'block';
    semanticId: string;
    documentHash?: string;
  }>;
  storyboardSections?: Array<{
    documentId: string;
    headerBlockId: string;
    contentHash: string;
  }>;
  comments?: Array<{ commentId: string }>;
  projectArtifacts?: Array<{
    artifactKind: 'document' | 'file' | 'asset' | 'lore' | 'repository';
    artifactId: string;
    contentHash?: string;
  }>;
  editorView?: EditorViewSubmission;
}

export interface ThreadVisibilityChrome {
  visibility: 'shared' | 'private';
  label: string;
  description: string;
  ownerOnly: boolean;
  canPublishThread: boolean;
  canPublishMemory: boolean;
  applySharesDocument: boolean;
  applySharesTranscript: boolean;
  tone: 'shared' | 'private-draft';
}

export function composeUiMessageParts(
  input: ComposeUiMessageInput,
): MessagePart[] {
  const parts: MessagePart[] = [];
  const text = input.text?.trim();
  if (text) {
    parts.push({ type: 'text', text });
  }
  for (const image of input.images ?? []) {
    parts.push({
      type: 'image_asset',
      assetId: image.assetId,
      contentHash: image.contentHash,
      purpose: image.purpose,
    });
  }
  for (const reference of input.uiReferences ?? []) {
    parts.push({
      type: 'ui_reference',
      referenceKind: reference.referenceKind,
      semanticId: reference.semanticId,
      documentHash: reference.documentHash,
    });
  }
  for (const section of input.storyboardSections ?? []) {
    parts.push({
      type: 'storyboard_section',
      documentId: section.documentId,
      headerBlockId: section.headerBlockId,
      contentHash: section.contentHash,
    });
  }
  for (const comment of input.comments ?? []) {
    parts.push({ type: 'comment', commentId: comment.commentId });
  }
  for (const artifact of input.projectArtifacts ?? []) {
    parts.push({
      type: 'project_artifact',
      artifactKind: artifact.artifactKind,
      artifactId: artifact.artifactId,
      contentHash: artifact.contentHash,
    });
  }
  if (input.editorView) {
    parts.push({ type: 'editor_view', view: input.editorView });
  }
  if (parts.length === 0) {
    throw new Error('A UI-agent message requires at least one typed part');
  }
  return parts.map((part) => MessagePartSchema.parse(part));
}

export function newMessageIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function threadVisibilityChrome(
  visibility: 'shared' | 'private',
): ThreadVisibilityChrome {
  if (visibility === 'private') {
    return {
      visibility,
      label: 'Private draft',
      description:
        'Only you can see this thread. Applying a proposal shares the document change, not this transcript.',
      ownerOnly: true,
      canPublishThread: true,
      canPublishMemory: true,
      applySharesDocument: true,
      applySharesTranscript: PRIVATE_APPLY_SHARES_TRANSCRIPT,
      tone: 'private-draft',
    };
  }
  return {
    visibility,
    label: 'Shared with project',
    description: 'Collaborators with document access can read this thread.',
    ownerOnly: false,
    canPublishThread: false,
    canPublishMemory: false,
    applySharesDocument: true,
    applySharesTranscript: true,
    tone: 'shared',
  };
}

export function appendMessageRequest(input: {
  parts: MessagePart[];
  citations?: SourceCitation[];
  execute?: boolean;
  intent?: string;
  modelPresetId?: string;
  selectionHints?: string[];
  idempotencyKey?: string;
}) {
  return {
    parts: input.parts,
    citations: input.citations ?? [],
    execute: input.execute === true,
    intent: input.intent,
    modelPresetId: input.modelPresetId,
    selectionHints: input.selectionHints,
    idempotencyKey: input.idempotencyKey ?? newMessageIdempotencyKey(),
  };
}

export function filterCitationsForViewer(
  citations: SourceCitation[],
  input: {
    viewerUserId: string;
    threadOwnerUserId: string;
    threadVisibility: 'shared' | 'private';
  },
): SourceCitation[] {
  if (input.threadVisibility === 'shared') {
    return citations.filter((citation) => citation.visibility !== 'private');
  }
  if (input.viewerUserId !== input.threadOwnerUserId) {
    return [];
  }
  return citations;
}

export function sharedThreadMessages(
  messages: UIAIMessage[],
  threads: ThreadSummary[],
): UIAIMessage[] {
  const sharedIds = new Set(
    threads
      .filter((thread) => thread.visibility === 'shared')
      .map((thread) => thread.threadId),
  );
  return messages
    .filter((message) => sharedIds.has(message.threadId))
    .map((message) => ({
      ...message,
      citations: message.citations.filter(
        (citation) => citation.visibility !== 'private',
      ),
    }));
}

export function privateThreadMustNotLeak(
  messages: UIAIMessage[],
  threads: ThreadSummary[],
): UIAIMessage[] {
  const leaked = sharedThreadMessages(messages, threads).filter(
    (message) =>
      message.visibility === 'private' ||
      message.citations.some((citation) => citation.visibility === 'private'),
  );
  if (leaked.length > 0) {
    throw new Error('Private thread content leaked into a shared aggregate');
  }
  return sharedThreadMessages(messages, threads);
}

export function staleCommentAnchorLabel(): string {
  return 'component removed';
}
