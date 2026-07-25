export const USER_OPS_QUEUE = 'user-ops';
export const GENERATIVE_MODEL_QUEUE = 'generative-model';
export const INTEGRATION_SYNC_QUEUE = 'integration-sync';
export const PROJECT_OPS_QUEUE = 'project-ops';
export const COLLAB_OPS_QUEUE = 'collab-ops';
export const RIGGING_QUEUE = 'rigging';
export const MESH2MOTION_QUEUE = 'mesh2motion';

// ── Generative-model job names ────────────────────────────────────────────────
export const JOB_REPLICATE_GENERATE_3D = 'replicate-generate-3d';
export const JOB_REPLICATE_POLL_3D = 'replicate-poll-3d';
export const JOB_OPENAI_DOCUMENT_SUGGESTION = 'openai-document-suggestion';
export const JOB_OPENAI_CONCEPT_ART = 'openai-concept-art';
export const JOB_REPLICATE_GENERATE_IMAGE = 'replicate-generate-image';
export const JOB_REPLICATE_POLL_IMAGE = 'replicate-poll-image';
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

export const JOB_COLLAB_COMMENT_NOTIFY = 'collab-comment-notify';

// ── Canvas workflow job names ─────────────────────────────────────────────────
export const JOB_CANVAS_IMAGE_SPLIT = 'canvas-image-split';
export const JOB_CANVAS_CONCEPT_ART_PERSIST = 'canvas-concept-art-persist';
export const JOB_CANVAS_MODEL_3D_IMPORT = 'canvas-model-3d-import';

// ── Rigging job names ─────────────────────────────────────────────────────────
export const JOB_RIG_ANYTHING = 'rig-anything';
export const JOB_MESH2MOTION = 'mesh2motion-rig';
