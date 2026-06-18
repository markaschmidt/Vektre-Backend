/** Structured suggestion returned by OpenAI for design documents. */
export interface DesignDocumentSuggestion {
  title?: string;
  summary?: string;
  suggestions: string[];
  tags?: string[];
}

/** Output reference for a generated asset (image, model, etc.) */
export interface GeneratedAssetRef {
  assetId: string;
  storageRef: string;
  mimeType: string;
  /** Original provider URL, valid until asset is imported */
  sourceUrl?: string;
}

export interface ConceptArtResult {
  assetRef: GeneratedAssetRef;
  revisedPrompt?: string;
}
