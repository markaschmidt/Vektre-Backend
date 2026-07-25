import type { RiggingJobStatus } from '../../integrations/app-data.types.js';

export const JOB_MESH2MOTION = 'mesh2motion-rig';

/** Mesh2Motion archetype templates (matches their RigConfig). */
export const MESH2MOTION_SKELETON_TYPES = [
  'human',
  'fox',
  'bird',
  'dragon',
  'kaiju',
  'spider',
  'snake',
  'fish',
] as const;

export type Mesh2MotionSkeletonType =
  (typeof MESH2MOTION_SKELETON_TYPES)[number];

export interface Mesh2MotionQueueJob {
  jobId: string;
  userId: string;
  sourceAssetId: string;
  outputAssetId: string;
  skeletonType: Mesh2MotionSkeletonType;
  /** When omitted/empty, worker bakes its default pack for the skeleton type. */
  animationNames: string[] | null;
  workerOptions?: {
    boneNaming?: 'default' | 'mixamo';
    exportContents?: 'full' | 'skeleton';
    mirror?: boolean;
    headWeightCorrection?: boolean;
    handSkeleton?: string | null;
    boneOverrides?: Record<string, unknown> | null;
  };
  /** Stable key sent to the worker so Bull retries do not duplicate work. */
  workerIdempotencyKey: string;
  enqueuedAt: string;
}

export type WorkerMesh2MotionStatus =
  | 'queued'
  | 'downloading'
  | 'fitting'
  | 'animating'
  | 'uploading'
  | 'completed'
  | 'failed';

export interface CreateMesh2MotionJobResponse {
  jobId: string;
  assetId: string;
  outputAssetId: string;
  skeletonType: Mesh2MotionSkeletonType;
  status: RiggingJobStatus;
}

export interface Mesh2MotionJobStatusResponse {
  jobId: string;
  status: RiggingJobStatus | WorkerMesh2MotionStatus;
  error: string | null;
  sourceAssetId: string;
  outputAssetId: string;
  projectId?: string | null;
  localProjectId?: string | null;
  /** Short-lived signed download URL when completed (~1h). */
  animatedAssetUrl: string | null;
  skeletonType: Mesh2MotionSkeletonType;
  animationNames: string[] | null;
}
