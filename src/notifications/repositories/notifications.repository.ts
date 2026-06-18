import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SupabaseService } from '../../integrations/supabase.js';
import type {
  CreateNotificationInput,
  ListNotificationsInput,
  NotificationRow,
} from '../models/notification.model.js';
import { type NotificationType } from '../models/notification.model.js';

@Injectable()
export class NotificationsRepository {
  private readonly logger = new Logger(NotificationsRepository.name);

  constructor(private readonly supabase: SupabaseService) {}

  async create(row: CreateNotificationInput): Promise<NotificationRow> {
    this.logger.debug(`create notification for ${row.userId}: ${row.type}`);
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .getAdminClient()
      .from('user_notification')
      .insert({
        notification_id: `ntf_${randomUUID()}`,
        user_id: row.userId,
        type: row.type,
        actor_user_id: row.actorUserId ?? null,
        project_id: row.projectId ?? null,
        asset_id: row.assetId ?? null,
        document_id: row.documentId ?? null,
        comment_id: row.commentId ?? null,
        parent_comment_id: row.parentCommentId ?? null,
        title: row.title,
        body: row.body ?? null,
        metadata_json: row.metadata ?? null,
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();

    if (error) throw new Error(`create notification failed: ${error.message}`);
    return mapNotificationRow(data);
  }

  async listForUser(
    userId: string,
    opts: ListNotificationsInput = {},
  ): Promise<NotificationRow[]> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    let query = this.supabase
      .getAdminClient()
      .from('user_notification')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (opts.status === 'unread') {
      query = query.is('read_at', null);
    }
    if (opts.before) {
      query = query.lt('created_at', opts.before.toISOString());
    }

    const { data, error } = await query;
    if (error) throw new Error(`list notifications failed: ${error.message}`);
    return (data ?? []).map(mapNotificationRow);
  }

  async unreadCount(userId: string): Promise<number> {
    const { count, error } = await this.supabase
      .getAdminClient()
      .from('user_notification')
      .select('notification_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null);

    if (error) throw new Error(`notification unread count failed: ${error.message}`);
    return count ?? 0;
  }

  async markRead(
    userId: string,
    notificationId: string,
  ): Promise<NotificationRow | null> {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .getAdminClient()
      .from('user_notification')
      .update({ read_at: now, updated_at: now })
      .eq('user_id', userId)
      .eq('notification_id', notificationId)
      .select('*')
      .maybeSingle();

    if (error) throw new Error(`mark notification read failed: ${error.message}`);
    return data ? mapNotificationRow(data) : null;
  }

  async markAllRead(userId: string): Promise<number> {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .getAdminClient()
      .from('user_notification')
      .update({ read_at: now, updated_at: now })
      .eq('user_id', userId)
      .is('read_at', null)
      .select('notification_id');

    if (error) throw new Error(`mark all notifications read failed: ${error.message}`);
    return data?.length ?? 0;
  }
}

function mapNotificationRow(row: Record<string, unknown>): NotificationRow {
  return {
    notificationId: row.notification_id as string,
    userId: row.user_id as string,
    type: row.type as NotificationType,
    actorUserId: (row.actor_user_id as string | null) ?? undefined,
    projectId: (row.project_id as string | null) ?? undefined,
    assetId: (row.asset_id as string | null) ?? undefined,
    documentId: (row.document_id as string | null) ?? undefined,
    commentId: (row.comment_id as string | null) ?? undefined,
    parentCommentId: (row.parent_comment_id as string | null) ?? undefined,
    title: row.title as string,
    body: (row.body as string | null) ?? undefined,
    metadata: (row.metadata_json as Record<string, unknown> | null) ?? undefined,
    readAt: row.read_at ? new Date(row.read_at as string) : undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}
