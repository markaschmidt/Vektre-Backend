import type { RequestStatus } from '../../integrations/app-data.types.js';

/**
 * Tauri AiJobStatus-compatible status for frontend polling.
 * Maps from internal RequestStatus at the API boundary.
 */
export type GenerativeJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled';

/** GET /generative-model/requests/:requestId response shape. */
export interface GenerativeRequestStatusResponse {
  requestId: string;
  userId: string;
  type: string;
  /** Internal durable status stored in Postgres. */
  status: RequestStatus;
  /** Tauri-compatible status — use this in Canvas polling code. */
  jobStatus: GenerativeJobStatus;
  /** Replicate prediction id while running / after completion. */
  predictionId?: string;
  /** Primary downloadable 3D model URL (GLB/GLTF/OBJ/ZIP). */
  modelUrl?: string;
  /** Preview render URL when Replicate returns one. */
  previewUrl?: string;
  /** Same as modelUrl on success — kept for generic job consumers. */
  outputRef?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}
