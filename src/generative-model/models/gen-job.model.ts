export type GenJobName =
  | 'run-inference'
  | 'replicate-generate-3d'
  | 'replicate-poll-3d'
  | 'openai-document-suggestion'
  | 'openai-concept-art'
  | 'ollama-document-suggestion';

export interface RunInferenceJob {
  requestId: string;
  userId: string;
  prompt: string;
  modelProvider: string;
  modelId: string;
  inputRefs: string[];
}

export interface ReplicateGenerate3dJob {
  requestId: string;
  userId: string;
  imageUrl?: string;
  prompt?: string;
}

export interface ReplicatePoll3dJob {
  requestId: string;
  userId: string;
  predictionId: string;
  /** ISO timestamp – processor skips if job queued time is too old */
  enqueuedAt: string;
}

export interface OpenAiDocumentSuggestionJob {
  requestId: string;
  userId: string;
  documentText: string;
  context?: string;
}

export interface OpenAiConceptArtJob {
  requestId: string;
  userId: string;
  prompt: string;
  style?: string;
}

export interface OllamaDocumentSuggestionJob {
  requestId: string;
  userId: string;
  documentText: string;
  modelId: string;
}
