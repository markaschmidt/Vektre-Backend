export type UserOpJobName =
  | 'sync-provider-documents'
  | 'recalculate-preferences';

export interface SyncProviderDocumentsJob {
  userId: string;
  provider: string;
  requestId: string;
}

export interface RecalculatePreferencesJob {
  userId: string;
  requestId: string;
}

export type UserOpJobData =
  | SyncProviderDocumentsJob
  | RecalculatePreferencesJob;
