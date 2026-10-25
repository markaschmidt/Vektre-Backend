import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as Y from 'yjs';
import { encodeStateVector, encodeStateAsUpdate } from 'yjs';
import type { ParsedDocumentName } from './document-name.js';

export function getCollabBucket(): string {
  return process.env.SUPABASE_COLLAB_BUCKET ?? 'collaboration-snapshots';
}

/** Most recent snapshot rows kept per document; older ones are pruned after each save. */
export function getSnapshotRetentionLimit(): number {
  const raw = Number(process.env.COLLAB_SNAPSHOT_RETENTION ?? '200');
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 200;
}

let adminClient: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'Supabase credentials are required for collaboration persistence',
    );
  }

  adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
  return adminClient;
}

/**
 * Path to the always-current Yjs update bytes for a document. This is the
 * single source of truth for "where does the latest content live" — read
 * both by the live Hocuspocus server (onLoadDocument) and by the plain REST
 * content endpoint (CollaborationDocumentsService.getDocumentContent), so
 * that fetching a document's latest content never depends on whether the
 * collaboration/live-sync server happens to be reachable.
 */
export function snapshotObjectPath(
  parsed: Pick<ParsedDocumentName, 'projectId' | 'documentType' | 'documentId'>,
): string {
  return `projects/${parsed.projectId}/docs/${parsed.documentType}/${parsed.documentId}/latest.yjs`;
}

/**
 * Pre-rename storage path when legacy cloud projects stored the 3D foundry
 * room under document_type `canvas`. Used as a read fallback only.
 */
export function legacyFoundrySnapshotObjectPath(
  parsed: Pick<ParsedDocumentName, 'projectId' | 'documentId'>,
): string {
  return `projects/${parsed.projectId}/docs/canvas/${parsed.documentId}/latest.yjs`;
}

/**
 * Path for an immutable per-version copy of the Yjs update bytes. The
 * "latest.yjs" object is overwritten on every save, so each
 * collaboration_snapshot row's storage_ref must point here instead — otherwise
 * every historical snapshot row would resolve to the current document state.
 */
export function snapshotVersionObjectPath(
  parsed: Pick<ParsedDocumentName, 'projectId' | 'documentType' | 'documentId'>,
  snapshotId: string,
): string {
  return `projects/${parsed.projectId}/docs/${parsed.documentType}/${parsed.documentId}/snapshots/${snapshotId}.yjs`;
}

/** Screenshot attached to a named snapshot. Same bucket, never a project_asset. */
export function snapshotPreviewObjectPath(
  parsed: Pick<ParsedDocumentName, 'projectId' | 'documentType' | 'documentId'>,
  snapshotId: string,
  extension: string,
): string {
  return `projects/${parsed.projectId}/docs/${parsed.documentType}/${parsed.documentId}/snapshots/${snapshotId}.preview.${extension}`;
}

function isDuplicateKeyError(error: {
  code?: string;
  message: string;
}): boolean {
  return (
    error.code === '23505' ||
    error.message.toLowerCase().includes('duplicate key')
  );
}

/**
 * Registers the collaboration_document row on first open, without touching
 * title/metadata on subsequent loads. Runs before the snapshot download so a
 * document row exists even when no Yjs bytes have been persisted yet.
 */
async function ensureDocumentMetadata(
  client: SupabaseClient,
  parsed: ParsedDocumentName,
): Promise<{ storageRef: string | null }> {
  const { data: meta, error: metaError } = await client
    .from('collaboration_document')
    .select('document_id, storage_ref')
    .eq('document_key', parsed.documentKey)
    .maybeSingle();

  if (metaError) {
    throw new Error(
      `collaboration_document lookup failed: ${metaError.message}`,
    );
  }

  if (meta) {
    return { storageRef: (meta.storage_ref as string | null) ?? null };
  }

  const { error: createError } = await client
    .from('collaboration_document')
    .insert({
      document_key: parsed.documentKey,
      document_id: parsed.documentId,
      project_id: parsed.projectId,
      document_type: parsed.documentType,
      title: 'Untitled',
      storage_ref: null,
      version: 0,
      updated_at: new Date().toISOString(),
    });

  // A concurrent first-open from another connection may race us to the insert;
  // that's fine, the row now exists either way.
  if (createError && !isDuplicateKeyError(createError)) {
    throw new Error(
      `collaboration_document create failed: ${createError.message}`,
    );
  }

  return { storageRef: null };
}

export async function loadDocumentSnapshot(
  parsed: ParsedDocumentName,
  document: Y.Doc,
): Promise<void> {
  const client = getAdminClient();
  const bucket = getCollabBucket();
  const objectPath = snapshotObjectPath(parsed);

  await ensureDocumentMetadata(client, parsed);

  const bytes = await downloadSnapshotBytes(client, bucket, objectPath);
  if (bytes === null && parsed.documentType === 'foundry') {
    const legacyPath = legacyFoundrySnapshotObjectPath(parsed);
    const legacyBytes = await downloadSnapshotBytes(client, bucket, legacyPath);
    if (legacyBytes !== null) {
      Y.applyUpdate(document, legacyBytes);
    }
    return;
  }

  if (bytes === null) return;

  Y.applyUpdate(document, bytes);
}

async function downloadSnapshotBytes(
  client: SupabaseClient,
  bucket: string,
  objectPath: string,
): Promise<Uint8Array | null> {
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
      return null;
    }
    throw new Error(`Snapshot download failed (${objectPath}): ${message}`);
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength === 0) return null;
  return bytes;
}

export async function storeDocumentSnapshot(
  parsed: ParsedDocumentName,
  document: Y.Doc,
  userId: string,
): Promise<StoredDocumentSnapshot> {
  const client = getAdminClient();
  const bucket = getCollabBucket();
  const objectPath = snapshotObjectPath(parsed);
  const storageRef = `supabase://${bucket}/${objectPath}`;
  const update = encodeStateAsUpdate(document);
  const stateVector = encodeStateVector(document);
  const now = new Date().toISOString();
  const buffer = Buffer.from(update);

  const { error: uploadError } = await client.storage
    .from(bucket)
    .upload(objectPath, buffer, {
      contentType: 'application/octet-stream',
      upsert: true,
    });
  if (uploadError) {
    throw new Error(
      `Snapshot upload failed (${objectPath}): ${uploadError.message}`,
    );
  }

  const snapshotId = `snap_${randomUUID()}`;
  const versionObjectPath = snapshotVersionObjectPath(parsed, snapshotId);
  const versionStorageRef = `supabase://${bucket}/${versionObjectPath}`;
  const { error: versionUploadError } = await client.storage
    .from(bucket)
    .upload(versionObjectPath, buffer, {
      contentType: 'application/octet-stream',
      upsert: true,
    });
  if (versionUploadError) {
    throw new Error(
      `Snapshot version upload failed (${versionObjectPath}): ${versionUploadError.message}`,
    );
  }

  const { data: existing, error: existingError } = await client
    .from('collaboration_document')
    .select('version')
    .eq('document_key', parsed.documentKey)
    .maybeSingle();
  if (existingError) {
    throw new Error(
      `collaboration_document lookup failed: ${existingError.message}`,
    );
  }

  const nextVersion = Number(existing?.version ?? 0) + 1;

  // Only set title/created_by_user_id when creating the row for the first time.
  // Snapshot saves are content/version metadata only — they must never clobber
  // a title the user (or the document registry API) has already set.
  const docPatch: Record<string, unknown> = {
    document_key: parsed.documentKey,
    document_id: parsed.documentId,
    project_id: parsed.projectId,
    document_type: parsed.documentType,
    storage_ref: storageRef,
    version: nextVersion,
    updated_by_user_id: userId,
    updated_at: now,
  };
  if (!existing) {
    docPatch.title = 'Untitled';
    docPatch.created_by_user_id = userId;
  }

  const { error: docError } = await client
    .from('collaboration_document')
    .upsert(docPatch);
  if (docError) {
    throw new Error(
      `collaboration_document upsert failed: ${docError.message}`,
    );
  }

  const { error: snapError } = await client
    .from('collaboration_snapshot')
    .insert({
      snapshot_id: snapshotId,
      document_key: parsed.documentKey,
      document_id: parsed.documentId,
      state_vector: Buffer.from(stateVector).toString('base64'),
      // Points at the immutable per-version copy, not the shared latest.yjs
      // pointer, so this snapshot row can still be restored after later saves.
      storage_ref: versionStorageRef,
      byte_length: update.byteLength,
      created_by_user_id: userId,
      created_at: now,
    });
  if (snapError) {
    throw new Error(
      `collaboration_snapshot insert failed: ${snapError.message}`,
    );
  }

  await pruneOldSnapshots(client, bucket, parsed.documentKey);
  return {
    snapshotId,
    stateVector: Buffer.from(stateVector).toString('base64'),
    storageRef: versionStorageRef,
  };
}

export interface StoredDocumentSnapshot {
  snapshotId: string;
  stateVector: string;
  storageRef: string;
}

/**
 * Retention: keep only the N most recent snapshot rows (and their per-version
 * storage objects) per document so frequent debounced saves don't grow
 * collaboration_snapshot unbounded. Best-effort — failures here must not fail
 * a live save, since losing old version history is recoverable but a broken
 * editing session is not.
 */
async function pruneOldSnapshots(
  client: SupabaseClient,
  bucket: string,
  documentKey: string,
): Promise<void> {
  const keep = getSnapshotRetentionLimit();

  const { data: staleRows, error: staleError } = await client
    .from('collaboration_snapshot')
    .select('snapshot_id, storage_ref, preview_storage_ref')
    .eq('document_key', documentKey)
    .is('name', null)
    .order('created_at', { ascending: false })
    .range(keep, keep + 500);

  if (staleError || !staleRows || staleRows.length === 0) return;

  const staleIds = staleRows.map((row) => row.snapshot_id as string);
  await client
    .from('collaboration_snapshot')
    .delete()
    .in('snapshot_id', staleIds);

  const staleObjectPaths = staleRows.flatMap((row) => {
    const paths = [
      storageRefToObjectPath(row.storage_ref as string | null),
      storageRefToObjectPath(row.preview_storage_ref as string | null),
    ];
    return paths.filter((path): path is string => Boolean(path));
  });
  if (staleObjectPaths.length > 0) {
    await client.storage.from(bucket).remove(staleObjectPaths);
  }
}

function storageRefToObjectPath(storageRef: string | null): string | null {
  if (!storageRef) return null;
  const match = /^supabase:\/\/[^/]+\/(.+)$/.exec(storageRef);
  return match ? match[1] : null;
}
