import { Injectable } from '@nestjs/common';
import {
  MessagePartSchema,
  SourceCitationSchema,
  type MessagePart,
  type SourceCitation,
} from '@markaschmidt/ui-builder-contracts';
import { SupabaseService } from '../../integrations/supabase.js';
import type {
  UiAiMessageRow,
  UiAiThreadRow,
  UiThreadStatus,
  UiVisibility,
} from '../models/ui-agent.model.js';

@Injectable()
export class UiConversationRepository {
  constructor(private readonly supabase: SupabaseService) {}

  private db() {
    return this.supabase.getAdminClient();
  }

  async createThread(input: {
    threadId: string;
    projectId: string;
    documentId?: string;
    documentKey?: string;
    ownerUserId: string;
    title: string;
    visibility: UiVisibility;
  }): Promise<UiAiThreadRow> {
    const { data, error } = queryResult<Record<string, unknown>>(
      await this.db()
        .from('ui_ai_thread')
        .insert({
          thread_id: input.threadId,
          project_id: input.projectId,
          document_id: input.documentId ?? null,
          document_key: input.documentKey ?? null,
          owner_user_id: input.ownerUserId,
          title: input.title,
          visibility: input.visibility,
        })
        .select('*')
        .single(),
    );
    assertNoError('createUiThread', error);
    return mapThread(data);
  }

  async getThread(
    projectId: string,
    documentId: string,
    threadId: string,
  ): Promise<UiAiThreadRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('ui_ai_thread')
        .select('*')
        .eq('project_id', projectId)
        .eq('document_id', documentId)
        .eq('thread_id', threadId)
        .neq('status', 'deleted')
        .maybeSingle(),
    );
    assertNoError('getUiThread', error);
    return data ? mapThread(data) : null;
  }

  async listVisibleThreads(input: {
    projectId: string;
    documentId: string;
    actorUserId: string;
    visibility?: 'all' | UiVisibility;
    status?: Exclude<UiThreadStatus, 'deleted'>;
    beforeOrder?: number;
    limit: number;
  }): Promise<UiAiThreadRow[]> {
    let query = this.db()
      .from('ui_ai_thread')
      .select('*')
      .eq('project_id', input.projectId)
      .eq('document_id', input.documentId)
      .neq('status', 'deleted')
      .or(
        `visibility.eq.shared,owner_user_id.eq.${sanitizeFilterValue(input.actorUserId)}`,
      )
      .order('thread_order', { ascending: false })
      .limit(input.limit);

    if (input.visibility && input.visibility !== 'all') {
      query = query.eq('visibility', input.visibility);
    }
    if (input.status) query = query.eq('status', input.status);
    if (input.beforeOrder) query = query.lt('thread_order', input.beforeOrder);

    const { data, error } = queryResult<Record<string, unknown>[]>(await query);
    assertNoError('listUiThreads', error);
    return (data ?? []).map(mapThread);
  }

  async updateThread(
    threadId: string,
    patch: { title?: string; status?: 'active' | 'archived' },
  ): Promise<UiAiThreadRow | null> {
    const update: Record<string, unknown> = {};
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.status !== undefined) update.status = patch.status;

    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('ui_ai_thread')
        .update(update)
        .eq('thread_id', threadId)
        .neq('status', 'deleted')
        .select('*')
        .maybeSingle(),
    );
    assertNoError('updateUiThread', error);
    return data ? mapThread(data) : null;
  }

  async publishPrivateThread(
    threadId: string,
    ownerUserId: string,
  ): Promise<UiAiThreadRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db().rpc('publish_private_ui_ai_thread', {
        p_thread_id: threadId,
        p_owner_user_id: ownerUserId,
      }),
    );
    assertNoError('publishPrivateUiThread', error);
    return data ? mapThread(data) : null;
  }

  async deletePrivateThread(
    threadId: string,
    ownerUserId: string,
  ): Promise<boolean> {
    const { data, error } = queryResult<boolean>(
      await this.db().rpc('delete_private_ui_ai_thread', {
        p_thread_id: threadId,
        p_owner_user_id: ownerUserId,
      }),
    );
    assertNoError('deletePrivateUiThread', error);
    return data === true;
  }

  async appendMessage(input: {
    messageId: string;
    thread: UiAiThreadRow;
    actorUserId: string;
    role: UiAiMessageRow['role'];
    parts: MessagePart[];
    citations: SourceCitation[];
    isSummary?: boolean;
    summarySourceMessageIds?: string[];
  }): Promise<UiAiMessageRow> {
    const { data, error } = queryResult<Record<string, unknown>>(
      await this.db()
        .from('ui_ai_message')
        .insert({
          message_id: input.messageId,
          thread_id: input.thread.threadId,
          project_id: input.thread.projectId,
          document_id: input.thread.documentId ?? null,
          actor_user_id: input.actorUserId,
          role: input.role,
          visibility: input.thread.visibility,
          owner_user_id: input.thread.ownerUserId,
          content_parts_json: input.parts,
          citations_json: input.citations,
          is_summary: input.isSummary ?? false,
          summary_source_message_ids: input.summarySourceMessageIds ?? [],
        })
        .select('*')
        .single(),
    );
    assertNoError('appendUiMessage', error);
    return mapMessage(data);
  }

  async getMessage(
    projectId: string,
    threadId: string,
    messageId: string,
  ): Promise<UiAiMessageRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('ui_ai_message')
        .select('*')
        .eq('project_id', projectId)
        .eq('thread_id', threadId)
        .eq('message_id', messageId)
        .maybeSingle(),
    );
    assertNoError('getUiMessage', error);
    return data ? mapMessage(data) : null;
  }

  async listMessages(input: {
    projectId: string;
    threadId: string;
    beforeOrder?: number;
    limit: number;
  }): Promise<UiAiMessageRow[]> {
    let query = this.db()
      .from('ui_ai_message')
      .select('*')
      .eq('project_id', input.projectId)
      .eq('thread_id', input.threadId)
      .order('message_order', { ascending: false })
      .limit(input.limit);

    if (input.beforeOrder) query = query.lt('message_order', input.beforeOrder);

    const { data, error } = queryResult<Record<string, unknown>[]>(await query);
    assertNoError('listUiMessages', error);
    return (data ?? []).map(mapMessage);
  }

  async exportMessages(threadId: string): Promise<UiAiMessageRow[]> {
    const { data, error } = queryResult<Record<string, unknown>[]>(
      await this.db()
        .from('ui_ai_message')
        .select('*')
        .eq('thread_id', threadId)
        .order('message_order', { ascending: true }),
    );
    assertNoError('exportUiMessages', error);
    return (data ?? []).map(mapMessage);
  }
}

function mapThread(row: Record<string, unknown>): UiAiThreadRow {
  return {
    threadId: row.thread_id as string,
    threadOrder: Number(row.thread_order),
    projectId: row.project_id as string,
    documentId: (row.document_id as string | null) ?? undefined,
    documentKey: (row.document_key as string | null) ?? undefined,
    ownerUserId: row.owner_user_id as string,
    title: row.title as string,
    visibility: row.visibility as UiVisibility,
    status: row.status as UiThreadStatus,
    publishedAt: row.published_at
      ? new Date(row.published_at as string)
      : undefined,
    deletedAt: row.deleted_at ? new Date(row.deleted_at as string) : undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapMessage(row: Record<string, unknown>): UiAiMessageRow {
  return {
    messageId: row.message_id as string,
    messageOrder: Number(row.message_order),
    threadId: row.thread_id as string,
    projectId: row.project_id as string,
    documentId: (row.document_id as string | null) ?? undefined,
    actorUserId: row.actor_user_id as string,
    role: row.role as UiAiMessageRow['role'],
    visibility: row.visibility as UiVisibility,
    ownerUserId: row.owner_user_id as string,
    parts: MessagePartSchema.array().parse(row.content_parts_json),
    citations: SourceCitationSchema.array().parse(row.citations_json ?? []),
    isSummary: row.is_summary === true,
    summarySourceMessageIds:
      (row.summary_source_message_ids as string[] | null) ?? [],
    createdAt: new Date(row.created_at as string),
  };
}

function sanitizeFilterValue(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

function assertNoError(
  operation: string,
  error: { message: string } | null,
): void {
  if (error) throw new Error(`${operation} failed: ${error.message}`);
}

function queryResult<T>(value: unknown): {
  data: T;
  error: { message: string } | null;
} {
  return value as {
    data: T;
    error: { message: string } | null;
  };
}
