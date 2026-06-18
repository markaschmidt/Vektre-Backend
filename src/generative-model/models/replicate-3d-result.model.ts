/** Persisted in request_status.result_json for replicate-3d jobs. */
export interface Replicate3dResultJson {
  predictionId?: string;
  modelUrl?: string;
  previewUrl?: string;
  modelUrls?: string[];
  previewUrls?: string[];
}
