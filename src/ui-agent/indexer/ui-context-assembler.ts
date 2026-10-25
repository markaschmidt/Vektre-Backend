import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ContextManifestSchema,
  JsonValueSchema,
  canonicalSha256,
  type ContextManifest,
  type JsonValue,
  type MessagePart,
  type SourceCitation,
} from '@markaschmidt/ui-builder-contracts';
import { AppDataService } from '../../integrations/app-data.service.js';
import type { ProjectCommentRow } from '../../integrations/app-data.types.js';
import type {
  UiAiMessageRow,
  UiDocumentRevisionRow,
  UiVisibility,
} from '../models/ui-agent.model.js';
import { UiConversationRepository } from '../repositories/ui-conversation.repository.js';
import { UiMemoryRepository } from '../repositories/ui-memory.repository.js';
import { generateUiAgentId } from '../ui-agent.ids.js';
import type {
  UiRetrievalDocumentInput,
  UiRetrievalResult,
} from './ui-context-index.model.js';
import { UiContextIndexRepository } from './ui-context-index.repository.js';

type ManifestSection = ContextManifest['sections'][number];
type ManifestSource = ManifestSection['sources'][number];

export interface UiContextAssemblyInput {
  manifestId?: string;
  runId: string;
  actorUserId: string;
  projectId: string;
  documentId: string;
  threadId: string;
  messageParts: MessagePart[];
  explicitCitations: SourceCitation[];
  revision: UiDocumentRevisionRow;
  modelPresetId: string;
  totalTokenBudget: number;
  intent: string;
  selectionHints?: string[];
  queryEmbedding?: number[];
  generatedAt?: Date;
}

@Injectable()
export class UiContextAssembler {
  constructor(
    private readonly appData: AppDataService,
    private readonly conversations: UiConversationRepository,
    private readonly memories: UiMemoryRepository,
    private readonly index: UiContextIndexRepository,
  ) {}

  async assemble(input: UiContextAssemblyInput): Promise<ContextManifest> {
    const thread = await this.conversations.getThread(
      input.projectId,
      input.documentId,
      input.threadId,
    );
    if (
      !thread ||
      (thread.visibility === 'private' &&
        thread.ownerUserId !== input.actorUserId)
    ) {
      throw new NotFoundException('Thread not found');
    }
    const includePrivate = thread.visibility === 'private';
    if (
      !includePrivate &&
      input.explicitCitations.some(
        (citation) => citation.visibility === 'private',
      )
    ) {
      throw new BadRequestException(
        'Private citations cannot be assembled into a shared run',
      );
    }
    const comments = await this.appData.listProjectComments(input.projectId, {
      documentId: input.documentId,
    });
    const [
      memory,
      messages,
      relations,
      exactResults,
      textResults,
      vectorResults,
    ] = await Promise.all([
      this.memories.listVisibleMemory({
        projectId: input.projectId,
        documentId: input.documentId,
        actorUserId: input.actorUserId,
        visibility: includePrivate ? 'all' : 'shared',
        status: 'accepted',
        limit: 200,
      }),
      this.conversations.listMessages({
        projectId: input.projectId,
        threadId: input.threadId,
        limit: 40,
      }),
      this.index.listArtifactRelations({
        projectId: input.projectId,
        documentId: input.documentId,
        actorUserId: input.actorUserId,
        includePrivate,
        limit: 100,
      }),
      this.index.getExactSources({
        projectId: input.projectId,
        documentId: input.documentId,
        actorUserId: input.actorUserId,
        includePrivate,
        references: exactReferences(input),
      }),
      this.index.searchText({
        projectId: input.projectId,
        documentId: input.documentId,
        actorUserId: input.actorUserId,
        includePrivate,
        query: retrievalQuery(input),
        limit: 30,
      }),
      input.queryEmbedding
        ? this.index
            .searchEmbeddings({
              projectId: input.projectId,
              documentId: input.documentId,
              actorUserId: input.actorUserId,
              includePrivate,
              embedding: input.queryEmbedding,
              limit: 20,
            })
            .catch(() => [])
        : Promise.resolve([]),
    ]);

    const budgetBySection = allocateBudgets(input.totalTokenBudget);
    const candidates = {
      live_document: [
        source({
          sourceId: input.documentId,
          sourceKind: 'document',
          content: {
            structuralDigest: input.revision.structuralDigest,
            layoutFingerprints: input.revision.layoutFingerprints,
          },
          contentHash: input.revision.documentHash,
          visibility: 'shared',
          selectionReason: 'live_document',
          rank: 0,
          label: 'Current GUI document',
        }),
      ],
      explicit_references: explicitSources(
        input,
        visibleRetrievalResults(
          exactResults,
          includePrivate,
          input.actorUserId,
        ),
        comments,
      ),
      memory: memory
        .filter(
          (item) =>
            item.visibility === 'shared' ||
            (includePrivate && item.ownerUserId === input.actorUserId),
        )
        .sort(
          (left, right) =>
            Number(right.pinned) - Number(left.pinned) ||
            right.memoryOrder - left.memoryOrder,
        )
        .map((item, rank) =>
          source({
            sourceId: item.memoryId,
            sourceKind: 'memory',
            content: {
              kind: item.kind,
              scope: item.scope,
              scopeId: item.scopeId ?? null,
              text: item.text,
              structuredValue: item.structuredValue ?? null,
              pinned: item.pinned,
            },
            visibility: item.visibility,
            selectionReason: 'accepted_memory',
            rank,
            label: `${item.kind.replaceAll('_', ' ')} memory`,
          }),
        ),
      comments: comments
        .filter((comment) => comment.status === 'open')
        .sort(
          (left, right) =>
            left.createdAt.getTime() - right.createdAt.getTime() ||
            left.commentId.localeCompare(right.commentId),
        )
        .map((comment, rank) =>
          source({
            sourceId: comment.commentId,
            sourceKind: 'comment',
            content: {
              body: comment.body,
              authorUserId: comment.authorUserId,
              parentCommentId: comment.parentCommentId ?? null,
              anchor: JsonValueSchema.parse(comment.anchor ?? {}),
              anchorStale: isCommentAnchorStale(
                comment.anchor,
                input.revision.layoutFingerprints,
              ),
              createdAt: comment.createdAt.toISOString(),
            },
            visibility: 'shared',
            selectionReason: 'unresolved_comment',
            rank,
            label: 'Unresolved comment',
          }),
        ),
      conversation: conversationSources(messages, thread.visibility),
      human_delta: humanDeltaSources(input.revision),
      artifacts: relations
        .filter(
          (relation) =>
            normalizeVisibility(relation.visibility) === 'shared' ||
            (includePrivate && relation.owner_user_id === input.actorUserId),
        )
        .sort((left, right) =>
          relationId(left.relation_id).localeCompare(
            relationId(right.relation_id),
          ),
        )
        .map((relation, rank) =>
          source({
            sourceId: relationId(relation.relation_id) || `relation-${rank}`,
            sourceKind: 'artifact',
            content: relation,
            visibility: normalizeVisibility(relation.visibility),
            selectionReason: 'artifact_relation',
            rank,
            label: 'Related project artifact',
          }),
        ),
      retrieval: mergeRetrievalResults(
        visibleRetrievalResults(textResults, includePrivate, input.actorUserId),
        visibleRetrievalResults(
          vectorResults,
          includePrivate,
          input.actorUserId,
        ),
      ).map(({ result, selectionReason }, rank) =>
        source({
          sourceId: result.sourceId,
          sourceKind: result.sourceKind,
          content: {
            title: result.title,
            text: result.contentText,
            metadata: result.metadata,
            score: result.rank,
          },
          contentHash: result.sourceHash,
          visibility: result.visibility,
          selectionReason,
          rank,
          label: result.title || result.sourceKind,
        }),
      ),
    } satisfies Record<ManifestSection['name'], ManifestSource[]>;

    const sections = (
      Object.keys(budgetBySection) as ManifestSection['name'][]
    ).map((name) => fitSection(name, budgetBySection[name], candidates[name]));
    const manifest = ContextManifestSchema.parse({
      schemaVersion: 1,
      manifestId: input.manifestId ?? generateUiAgentId('uictx'),
      runId: input.runId,
      projectId: input.projectId,
      documentId: input.documentId,
      threadId: input.threadId,
      actorId: input.actorUserId,
      documentRevision: input.revision.revisionId,
      documentHash: input.revision.documentHash,
      modelPresetId: input.modelPresetId,
      totalTokenBudget: input.totalTokenBudget,
      estimatedTokens: sections.reduce(
        (total, section) => total + section.estimatedTokens,
        0,
      ),
      sections,
      generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    });
    return manifest;
  }
}

function explicitSources(
  input: UiContextAssemblyInput,
  exactResults: UiRetrievalResult[],
  comments: ProjectCommentRow[],
): ManifestSource[] {
  const exactKeys = new Set(
    exactResults.map((result) => `${result.sourceKind}:${result.sourceId}`),
  );
  const exact = exactResults.map((result, rank) =>
    source({
      sourceId: result.sourceId,
      sourceKind: result.sourceKind,
      content: {
        title: result.title,
        text: result.contentText,
        metadata: result.metadata,
      },
      contentHash: result.sourceHash,
      visibility: result.visibility,
      selectionReason: 'explicit_reference',
      rank,
      label: result.title || `Explicit ${result.sourceKind}`,
    }),
  );
  const parts = input.messageParts
    .filter((part) => part.type !== 'text')
    .filter(
      (part) =>
        !exactKeys.has(
          `${partSourceKind(part)}:${explicitPartId(part, input.runId, 0)}`,
        ),
    )
    .map((part, rank) => {
      const comment =
        part.type === 'comment'
          ? comments.find((item) => item.commentId === part.commentId)
          : undefined;
      return source({
        sourceId: explicitPartId(part, input.runId, rank),
        sourceKind: partSourceKind(part),
        content: comment
          ? {
              commentId: comment.commentId,
              body: comment.body,
              status: comment.status,
              anchor: JsonValueSchema.parse(comment.anchor ?? {}),
              authorUserId: comment.authorUserId,
              createdAt: comment.createdAt.toISOString(),
            }
          : part,
        contentHash:
          'contentHash' in part && typeof part.contentHash === 'string'
            ? part.contentHash
            : undefined,
        visibility: 'shared',
        selectionReason: 'explicit_reference',
        rank: exact.length + rank,
        label: `Explicit ${part.type.replaceAll('_', ' ')}`,
      });
    });
  const citations = input.explicitCitations
    .filter(
      (citation) =>
        !exactKeys.has(`${citation.sourceKind}:${citation.sourceId}`),
    )
    .map((citation, index) =>
      source({
        sourceId: citation.sourceId,
        sourceKind: citation.sourceKind,
        content: {
          label: citation.label ?? null,
          locator: citation.locator ?? null,
          excerpt: citation.excerpt ?? null,
        },
        contentHash: citation.contentHash,
        visibility: citation.visibility,
        selectionReason: 'explicit_reference',
        rank: exact.length + parts.length + index,
        label: citation.label ?? 'Explicit citation',
        citation,
      }),
    );
  return [...exact, ...parts, ...citations];
}

function conversationSources(
  messages: UiAiMessageRow[],
  visibility: UiVisibility,
): ManifestSource[] {
  return [...messages].reverse().map((message, rank) =>
    source({
      sourceId: message.messageId,
      sourceKind: 'message',
      content: {
        role: message.role,
        parts: message.parts,
        createdAt: message.createdAt.toISOString(),
        summarySourceMessageIds: message.summarySourceMessageIds,
      },
      visibility,
      selectionReason: message.isSummary ? 'summary' : 'recent_message',
      rank,
      label: message.isSummary
        ? 'Conversation summary'
        : `${message.role} message`,
    }),
  );
}

function humanDeltaSources(revision: UiDocumentRevisionRow): ManifestSource[] {
  const digest = isRecord(revision.structuralDigest)
    ? revision.structuralDigest
    : {};
  const delta = digest.humanDelta;
  if (!delta) return [];
  return [
    source({
      sourceId: `${revision.revisionId}-human-delta`,
      sourceKind: 'document',
      content: delta,
      visibility: 'shared',
      selectionReason: 'human_delta',
      rank: 0,
      label: 'Changes since the accepted AI baseline',
    }),
  ];
}

function mergeRetrievalResults(
  text: UiRetrievalResult[],
  vector: UiRetrievalResult[],
): Array<{
  result: UiRetrievalResult;
  selectionReason: 'full_text' | 'vector';
}> {
  const merged = new Map<
    string,
    { result: UiRetrievalResult; selectionReason: 'full_text' | 'vector' }
  >();
  text.forEach((result) =>
    merged.set(`${result.sourceKind}:${result.sourceId}`, {
      result,
      selectionReason: 'full_text',
    }),
  );
  vector.forEach((result) => {
    const key = `${result.sourceKind}:${result.sourceId}`;
    if (!merged.has(key)) {
      merged.set(key, { result, selectionReason: 'vector' });
    }
  });
  return [...merged.values()].sort(
    (left, right) =>
      right.result.rank - left.result.rank ||
      left.result.sourceKind.localeCompare(right.result.sourceKind) ||
      left.result.sourceId.localeCompare(right.result.sourceId),
  );
}

function visibleRetrievalResults(
  results: UiRetrievalResult[],
  includePrivate: boolean,
  actorUserId: string,
): UiRetrievalResult[] {
  return results.filter(
    (result) =>
      result.visibility === 'shared' ||
      (includePrivate && result.ownerUserId === actorUserId),
  );
}

function source(input: {
  sourceId: string;
  sourceKind: ManifestSource['sourceKind'];
  content: JsonValue;
  contentHash?: string;
  visibility: ManifestSource['visibility'];
  selectionReason: ManifestSource['selectionReason'];
  rank: number;
  label: string;
  citation?: SourceCitation;
}): ManifestSource {
  const contentHash = input.contentHash ?? canonicalSha256(input.content);
  const estimatedTokens = estimateTokens(input.content);
  return {
    sourceId: input.sourceId,
    sourceKind: input.sourceKind,
    contentHash,
    visibility: input.visibility,
    selectionReason: input.selectionReason,
    rank: input.rank,
    estimatedTokens,
    content: input.content,
    citation: input.citation ?? {
      sourceId: input.sourceId,
      sourceKind: input.sourceKind,
      contentHash,
      visibility: input.visibility,
      label: input.label.slice(0, 256),
    },
    truncated: false,
  };
}

function fitSection(
  name: ManifestSection['name'],
  tokenBudget: number,
  candidates: ManifestSource[],
): ManifestSection {
  const sources: ManifestSource[] = [];
  let remaining = tokenBudget;
  for (const candidate of candidates) {
    if (remaining <= 0) break;
    if (candidate.estimatedTokens <= remaining) {
      sources.push(candidate);
      remaining -= candidate.estimatedTokens;
      continue;
    }
    const serialized = JSON.stringify(candidate.content);
    const maxCharacters = Math.max(0, remaining * 4 - 16);
    if (maxCharacters < 8) break;
    const content = serialized.slice(0, maxCharacters);
    const estimatedTokens = Math.min(remaining, estimateTokens(content));
    sources.push({
      ...candidate,
      content,
      estimatedTokens,
      truncated: true,
    });
    remaining -= estimatedTokens;
  }
  return {
    name,
    tokenBudget,
    estimatedTokens: tokenBudget - remaining,
    sources,
  };
}

function allocateBudgets(
  total: number,
): Record<ManifestSection['name'], number> {
  const names: ManifestSection['name'][] = [
    'live_document',
    'explicit_references',
    'memory',
    'comments',
    'conversation',
    'human_delta',
    'artifacts',
    'retrieval',
  ];
  const weights = [25, 20, 15, 10, 15, 5, 5, 5];
  const result = {} as Record<ManifestSection['name'], number>;
  let allocated = 0;
  names.forEach((name, index) => {
    const budget =
      index === names.length - 1
        ? total - allocated
        : Math.floor((total * (weights[index] ?? 0)) / 100);
    result[name] = budget;
    allocated += budget;
  });
  return result;
}

function estimateTokens(value: JsonValue): number {
  return Math.max(1, Math.ceil(JSON.stringify(value).length / 4));
}

function retrievalQuery(input: UiContextAssemblyInput): string {
  const text = input.messageParts
    .filter(
      (part): part is Extract<MessagePart, { type: 'text' }> =>
        part.type === 'text',
    )
    .map((part) => part.text)
    .join(' ');
  return [input.intent, text, ...(input.selectionHints ?? [])]
    .join(' ')
    .slice(0, 8_000);
}

function exactReferences(input: UiContextAssemblyInput): Array<{
  sourceKind: UiRetrievalDocumentInput['sourceKind'];
  sourceId: string;
}> {
  const references = input.messageParts
    .filter(
      (part): part is Exclude<MessagePart, { type: 'text' | 'editor_view' }> =>
        part.type !== 'text' && part.type !== 'editor_view',
    )
    .map((part, index) => ({
      sourceKind: partSourceKind(part),
      sourceId: explicitPartId(part, input.runId, index),
    }));
  for (const citation of input.explicitCitations) {
    if (citation.sourceKind === 'message') continue;
    references.push({
      sourceKind: citation.sourceKind,
      sourceId: citation.sourceId,
    });
  }
  return [
    ...new Map(
      references.map((reference) => [
        `${reference.sourceKind}:${reference.sourceId}`,
        reference,
      ]),
    ).values(),
  ];
}

function explicitPartId(
  part: Exclude<MessagePart, { type: 'text' }>,
  runId: string,
  index: number,
): string {
  switch (part.type) {
    case 'image_asset':
      return part.assetId;
    case 'ui_reference':
      return part.semanticId;
    case 'storyboard_section':
      return `${part.documentId}-${part.headerBlockId}`;
    case 'comment':
      return part.commentId;
    case 'project_artifact':
      return part.artifactId;
    case 'editor_view':
      return part.view.fieldOfView.screenId;
  }
  return `${runId}-part-${index}`;
}

function partSourceKind(
  part: Exclude<MessagePart, { type: 'text' }>,
): UiRetrievalDocumentInput['sourceKind'] {
  switch (part.type) {
    case 'image_asset':
      return 'asset';
    case 'ui_reference':
      return part.referenceKind;
    case 'storyboard_section':
      return 'storyboard';
    case 'comment':
      return 'comment';
    case 'project_artifact':
      return part.artifactKind === 'asset' ? 'asset' : 'artifact';
    case 'editor_view':
      return 'document';
  }
}

function isCommentAnchorStale(
  anchor: Record<string, unknown> | undefined,
  layoutFingerprints: JsonValue,
): boolean {
  if (!anchor) return false;
  const id =
    typeof anchor.componentId === 'string'
      ? anchor.componentId
      : typeof anchor.groupId === 'string'
        ? anchor.groupId
        : typeof anchor.blockId === 'string'
          ? anchor.blockId
          : undefined;
  return (
    Boolean(id) &&
    (!isRecord(layoutFingerprints) || !(id! in layoutFingerprints))
  );
}

function normalizeVisibility(value: JsonValue | undefined): UiVisibility {
  return value === 'private' ? 'private' : 'shared';
}

function relationId(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
