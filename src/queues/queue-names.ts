export const USER_OPS_QUEUE = 'user-ops';
export const GENERATIVE_MODEL_QUEUE = 'generative-model';
export const INTEGRATION_SYNC_QUEUE = 'integration-sync';
export const PROJECT_OPS_QUEUE = 'project-ops';

// ── Generative-model job names ────────────────────────────────────────────────
export const JOB_REPLICATE_GENERATE_3D = 'replicate-generate-3d';
export const JOB_REPLICATE_POLL_3D = 'replicate-poll-3d';
export const JOB_OPENAI_DOCUMENT_SUGGESTION = 'openai-document-suggestion';
export const JOB_OPENAI_CONCEPT_ART = 'openai-concept-art';
export const JOB_OLLAMA_DOCUMENT_SUGGESTION = 'ollama-document-suggestion';

// ── Integration-sync job names ────────────────────────────────────────────────
export const JOB_GOOGLE_DRIVE_SYNC = 'google-drive-sync';
export const JOB_GOOGLE_DRIVE_IMPORT = 'google-drive-import';
export const JOB_NOTION_SEARCH = 'notion-search';
export const JOB_NOTION_IMPORT_PAGE = 'notion-import-page';
export const JOB_NOTION_EXPORT_PAGE = 'notion-export-page';

// ── Project job names ─────────────────────────────────────────────────────────
export const JOB_PROJECT_CREATE = 'project-create';
export const JOB_PROJECT_UPDATE = 'project-update';
export const JOB_PROJECT_ARCHIVE = 'project-archive';
export const JOB_PROJECT_DELETE = 'project-delete';
export const JOB_PROJECT_MEMBER_UPSERT = 'project-member-upsert';
export const JOB_PROJECT_MEMBER_REMOVE = 'project-member-remove';
export const JOB_PROJECT_ASSET_UPSERT = 'project-asset-upsert';
export const JOB_PROJECT_ASSET_REMOVE = 'project-asset-remove';
