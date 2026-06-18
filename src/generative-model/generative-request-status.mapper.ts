import type { RequestStatus, RequestStatusRow } from '../integrations/app-data.types.js';
import type {
  GenerativeJobStatus,
  GenerativeRequestStatusResponse,
} from './models/generative-request-status.model.js';
import type { Replicate3dResultJson } from './models/replicate-3d-result.model.js';

const REPLICATE_PREDICTION_PREFIX = 'replicate-prediction:';

export function mapRequestStatusToJobStatus(
  status: RequestStatus,
): GenerativeJobStatus {
  switch (status) {
    case 'pending':
    case 'queued':
      return 'queued';
    case 'processing':
      return 'running';
    case 'completed':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'canceled';
    default:
      return 'queued';
  }
}

export function mapGenerativeRequestStatus(
  row: RequestStatusRow,
): GenerativeRequestStatusResponse {
  const result = (row.resultJson ?? {}) as Replicate3dResultJson;
  const predictionId =
    result.predictionId ?? parsePredictionIdFromOutputRef(row.outputRef);

  const base: GenerativeRequestStatusResponse = {
    requestId: row.requestId,
    userId: row.userId,
    type: row.type,
    status: row.status,
    jobStatus: mapRequestStatusToJobStatus(row.status),
    predictionId,
    outputRef: row.outputRef,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  if (row.type !== 'replicate-3d') {
    return base;
  }

  return {
    ...base,
    predictionId,
    modelUrl: result.modelUrl,
    previewUrl: result.previewUrl,
    // On success outputRef is the model URL; while running it may be replicate-prediction:{id}.
    outputRef:
      row.status === 'completed' && result.modelUrl
        ? result.modelUrl
        : row.outputRef,
  };
}

function parsePredictionIdFromOutputRef(
  outputRef?: string,
): string | undefined {
  if (!outputRef?.startsWith(REPLICATE_PREDICTION_PREFIX)) return undefined;
  return outputRef.slice(REPLICATE_PREDICTION_PREFIX.length);
}
