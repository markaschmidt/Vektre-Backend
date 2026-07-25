import type { RiggingJobStatus } from '../../integrations/app-data.types.js';

export const JOB_RIG_ANYTHING = 'rig-anything';

export interface RigAnythingQueueJob {
  jobId: string;
  userId: string;
  sourceAssetId: string;
  outputAssetId: string;
  simplify: boolean;
  targetFaceCount: number;
  /** Stable key sent to RunPod so Bull retries do not duplicate GPU work. */
  workerIdempotencyKey: string;
  enqueuedAt: string;
}

export type WorkerRigStatus =
  | 'queued'
  | 'downloading'
  | 'rigging'
  | 'uploading'
  | 'completed'
  | 'failed';

export interface CreateRiggingJobResponse {
  jobId: string;
  assetId: string;
  outputAssetId: string;
  status: RiggingJobStatus;
}

export interface RiggingJobStatusResponse {
  jobId: string;
  status: RiggingJobStatus | WorkerRigStatus;
  error: string | null;
  sourceAssetId: string;
  outputAssetId: string;
  projectId?: string | null;
  localProjectId?: string | null;
  riggedAssetUrl: string | null;
  simplify: boolean;
  targetFaceCount: number;
}
