import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as Y from 'yjs';
import { encodeStateVector, encodeStateAsUpdate } from 'yjs';
import type { ParsedDocumentName } from './document-name.js';

export function getCollabBucket(): string {
  return process.env.SUPABASE_COLLAB_BUCKET ?? 'collaboration-snapshots';
}

let adminClient: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Supabase credentials are required for collaboration persistence');
  }

  adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  return adminClient;
}

function snapshotObjectPath(parsed: ParsedDocumentName): string {
  return `projects/${parsed.projectId}/docs/${parsed.documentType}/${parsed.documentId}/latest.yjs`;
}

export async function loadDocumentSnapshot(
  parsed: ParsedDocumentName,
  document: Y.Doc,
): Promise<void> {
  const client = getAdminClient();
  const bucket = getCollabBucket();
  const objectPath = snapshotObjectPath(parsed);

  const { data: meta, error: metaError } = await client
    .from('collaboration_document')
    .select('document_id, storage_ref')
    .eq('document_key', parsed.documentKey)
    .maybeSingle();

  if (metaError) {
    throw new Error(`collaboration_document lookup failed: ${metaError.message}`);
  }

  const storageRef = (meta?.storage_ref as string | null) ?? `supabase://${bucket}/${objectPath}`;

  const { data: blob, error: downloadError } = await client.storage
    .from(bucket)
    .download(objectPath);

  if (downloadError || !blob) {
    const message = downloadError?.message ?? 'empty response';
    if (
      message.includes('not found') ||
      message.includes('Not Found') ||
      message.includes('Object not found')
    ) {
      return;
    }
    throw new Error(`Snapshot download failed (${objectPath}): ${message}`);
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength === 0) return;

  Y.applyUpdate(document, bytes);
  if (!meta) {
    await client.from('collaboration_document').upsert({
      document_key: parsed.documentKey,
      document_id: parsed.documentId,
      project_id: parsed.projectId,
      document_type: parsed.documentType,
      title: 'Untitled',
      storage_ref: storageRef,
      version: 0,
      updated_at: new Date().toISOString(),
    });
  }
}

export async function storeDocumentSnapshot(
  parsed: ParsedDocumentName,
  document: Y.Doc,
  userId: string,
): Promise<void> {
  const client = getAdminClient();
  const bucket = getCollabBucket();
  const objectPath = snapshotObjectPath(parsed);
  const storageRef = `supabase://${bucket}/${objectPath}`;
  const update = encodeStateAsUpdate(document);
  const stateVector = encodeStateVector(document);
  const now = new Date().toISOString();

  const { error: uploadError } = await client.storage
    .from(bucket)
    .upload(objectPath, Buffer.from(update), {
      contentType: 'application/octet-stream',
      upsert: true,
    });
  if (uploadError) {
    throw new Error(`Snapshot upload failed (${objectPath}): ${uploadError.message}`);
  }

  const { data: existing, error: existingError } = await client
    .from('collaboration_document')
    .select('version')
    .eq('document_key', parsed.documentKey)
    .maybeSingle();
  if (existingError) {
    throw new Error(`collaboration_document lookup failed: ${existingError.message}`);
  }

  const nextVersion = Number(existing?.version ?? 0) + 1;
  const { error: docError } = await client.from('collaboration_document').upsert({
    document_key: parsed.documentKey,
    document_id: parsed.documentId,
    project_id: parsed.projectId,
    document_type: parsed.documentType,
    title: 'Untitled',
    storage_ref: storageRef,
    version: nextVersion,
    updated_by_user_id: userId,
    updated_at: now,
  });
  if (docError) {
    throw new Error(`collaboration_document upsert failed: ${docError.message}`);
  }

  const snapshotId = `snap_${randomUUID()}`;
  const { error: snapError } = await client.from('collaboration_snapshot').insert({
    snapshot_id: snapshotId,
    document_key: parsed.documentKey,
    document_id: parsed.documentId,
    state_vector: Buffer.from(stateVector).toString('base64'),
    storage_ref: storageRef,
    byte_length: update.byteLength,
    created_by_user_id: userId,
    created_at: now,
  });
  if (snapError) {
    throw new Error(`collaboration_snapshot insert failed: ${snapError.message}`);
  }
}
