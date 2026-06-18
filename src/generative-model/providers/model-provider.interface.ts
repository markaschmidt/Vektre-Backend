export interface ModelProviderAdapter {
  /**
   * Run inference for the given request.
   * Returns a reference to the stored output (e.g. storage key or URL).
   */
  runInference(params: {
    requestId: string;
    userId: string;
    prompt: string;
    modelId: string;
    inputRefs: string[];
  }): Promise<string>;
}

export const MODEL_PROVIDER_ADAPTERS = 'MODEL_PROVIDER_ADAPTERS';
