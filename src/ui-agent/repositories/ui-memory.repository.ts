import { Injectable } from '@nestjs/common';
import {
  DesignMemoryProvenanceSchema,
  JsonValueSchema,
  type DesignMemoryRecord,
  type JsonValue,
} from '@markaschmidt/ui-builder-contracts';
import { SupabaseService } from '../../integrations/supabase.js';
import type {
  UiDesignMemoryRow,
  UiVisibility,
} from '../models/ui-agent.model.js';

@Injectable()
export class UiMemoryRepository {
  constructor(private readonly supabase: SupabaseService) {}

  private db() {
    return this.supabase.getAdminClient();
  }

  async createMemory(input: {
    memoryId: string;
    projectId: string;
    documentId?: string;
    threadId?: string;
    ownerUserId: string;
    kind: DesignMemoryRecord['kind'];
    scope: DesignMemoryRecord['scope'];
    scopeId?: string;
    text: string;
    structuredValue?: JsonValue;
    status?: DesignMemoryRecord['status'];
    visibility: UiVisibility;
    pinned: boolean;
    effectiveRevision?: string;
    provenance: DesignMemoryRecord['provenance'];
  }): Promise<UiDesignMemoryRow> {
    const { data, error } = queryResult<Record<string, unknown>>(
      await this.db()
        .from('ui_design_memory')
        .insert({
          memory_id: input.memoryId,
          project_id: input.projectId,
          document_id: input.documentId ?? null,
          thread_id: input.threadId ?? null,
          owner_user_id: input.ownerUserId,
          kind: input.kind,
          scope: input.scope,
          scope_id: input.scopeId ?? null,
          text_value: input.text,
          structured_value_json: input.structuredValue ?? null,
          status: input.status ?? 'proposed',
          visibility: input.visibility,
          pinned: input.pinned,
          effective_revision: input.effectiveRevision ?? null,
          provenance_json: input.provenance,
        })
        .select('*')
        .single(),
    );
    assertNoError('createUiMemory', error);
    return mapMemory(data);
  }

  async getMemory(
    projectId: string,
    documentId: string,
    memoryId: string,
  ): Promise<UiDesignMemoryRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('ui_design_memory')
        .select('*')
        .eq('project_id', projectId)
        .eq('document_id', documentId)
        .eq('memory_id', memoryId)
        .maybeSingle(),
    );
    assertNoError('getUiMemory', error);
    return data ? mapMemory(data) : null;
  }

  async getMemoryById(
    projectId: string,
    memoryId: string,
  ): Promise<UiDesignMemoryRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('ui_design_memory')
        .select('*')
        .eq('project_id', projectId)
        .eq('memory_id', memoryId)
        .maybeSingle(),
    );
    assertNoError('getUiMemoryById', error);
    return data ? mapMemory(data) : null;
  }

  async listVisibleMemory(input: {
    projectId: string;
    documentId: string;
    actorUserId: string;
    visibility?: 'all' | UiVisibility;
    status?: DesignMemoryRecord['status'];
    kind?: DesignMemoryRecord['kind'];
    scope?: DesignMemoryRecord['scope'];
    scopeId?: string;
    beforeOrder?: number;
    limit: number;
  }): Promise<UiDesignMemoryRow[]> {
    let query = this.db()
      .from('ui_design_memory')
      .select('*')
      .eq('project_id', input.projectId)
      .eq('document_id', input.documentId)
      .or(
        `visibility.eq.shared,owner_user_id.eq.${sanitizeFilterValue(input.actorUserId)}`,
      )
      .order('memory_order', { ascending: false })
      .limit(input.limit);

    if (input.visibility && input.visibility !== 'all') {
      query = query.eq('visibility', input.visibility);
    }
    if (input.status) query = query.eq('status', input.status);
    if (input.kind) query = query.eq('kind', input.kind);
    if (input.scope) query = query.eq('scope', input.scope);
    if (input.scopeId) query = query.eq('scope_id', input.scopeId);
    if (input.beforeOrder) query = query.lt('memory_order', input.beforeOrder);

    const { data, error } = queryResult<Record<string, unknown>[]>(await query);
    assertNoError('listUiMemory', error);
    return (data ?? []).map(mapMemory);
  }

  async transitionMemory(input: {
    memoryId: string;
    fromStatuses: DesignMemoryRecord['status'][];
    status: DesignMemoryRecord['status'];
    reviewedByUserId: string;
    effectiveRevision?: string;
  }): Promise<UiDesignMemoryRow | null> {
    const update: Record<string, unknown> = {
      status: input.status,
      reviewed_by_user_id: input.reviewedByUserId,
      reviewed_at: new Date().toISOString(),
    };
    if (input.effectiveRevision !== undefined) {
      update.effective_revision = input.effectiveRevision;
    }
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('ui_design_memory')
        .update(update)
        .eq('memory_id', input.memoryId)
        .in('status', input.fromStatuses)
        .select('*')
        .maybeSingle(),
    );
    assertNoError('transitionUiMemory', error);
    return data ? mapMemory(data) : null;
  }

  async supersedeMemory(
    memoryId: string,
    replacementMemoryId: string,
    actorUserId: string,
  ): Promise<UiDesignMemoryRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db().rpc('supersede_ui_design_memory', {
        p_memory_id: memoryId,
        p_replacement_memory_id: replacementMemoryId,
        p_actor_user_id: actorUserId,
      }),
    );
    assertNoError('supersedeUiMemory', error);
    return data ? mapMemory(data) : null;
  }

  async listThreadMemory(threadId: string): Promise<UiDesignMemoryRow[]> {
    const { data, error } = queryResult<Record<string, unknown>[]>(
      await this.db()
        .from('ui_design_memory')
        .select('*')
        .eq('thread_id', threadId)
        .order('memory_order', { ascending: true }),
    );
    assertNoError('listThreadUiMemory', error);
    return (data ?? []).map(mapMemory);
  }
}

function mapMemory(row: Record<string, unknown>): UiDesignMemoryRow {
  return {
    memoryId: row.memory_id as string,
    memoryOrder: Number(row.memory_order),
    projectId: row.project_id as string,
    documentId: (row.document_id as string | null) ?? undefined,
    threadId: (row.thread_id as string | null) ?? undefined,
    ownerUserId: row.owner_user_id as string,
    kind: row.kind as DesignMemoryRecord['kind'],
    scope: row.scope as DesignMemoryRecord['scope'],
    scopeId: (row.scope_id as string | null) ?? undefined,
    text: row.text_value as string,
    structuredValue:
      row.structured_value_json == null
        ? undefined
        : JsonValueSchema.parse(row.structured_value_json),
    status: row.status as DesignMemoryRecord['status'],
    visibility: row.visibility as UiVisibility,
    pinned: row.pinned === true,
    effectiveRevision: (row.effective_revision as string | null) ?? undefined,
    reviewedByUserId: (row.reviewed_by_user_id as string | null) ?? undefined,
    reviewedAt: row.reviewed_at
      ? new Date(row.reviewed_at as string)
      : undefined,
    supersededByMemoryId:
      (row.superseded_by_memory_id as string | null) ?? undefined,
    provenance: DesignMemoryProvenanceSchema.parse(row.provenance_json),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
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
