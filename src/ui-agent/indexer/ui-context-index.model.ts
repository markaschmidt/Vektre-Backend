import type {
  ContractValidationIssue,
  JsonValue,
  VektreUIDocumentV2,
} from '@markaschmidt/ui-builder-contracts';
import type { UiVisibility } from '../models/ui-agent.model.js';

export interface CollaborationSnapshotSource {
  snapshotId: string;
  documentKey: string;
  stateVector?: string;
  storageRef: string;
  createdAt: Date;
}

export interface UiContextIndexAttemptRow {
  attemptId: string;
  projectId: string;
  documentId: string;
  documentKey: string;
  snapshotId: string;
  status: 'valid' | 'invalid' | 'failed';
  revisionId?: string;
  documentHash?: string;
  validationIssues: ContractValidationIssue[];
  errorCode?: string;
  errorMessage?: string;
  completedAt: Date;
}

export interface UiRetrievalDocumentInput {
  retrievalId: string;
  projectId: string;
  documentId?: string;
  threadId?: string;
  ownerUserId: string;
  visibility: UiVisibility;
  sourceKind:
    | 'document'
    | 'screen'
    | 'group'
    | 'component'
    | 'block'
    | 'asset'
    | 'storyboard'
    | 'comment'
    | 'artifact'
    | 'memory';
  sourceId: string;
  sourceHash: string;
  title: string;
  contentText: string;
  metadata: Record<string, JsonValue>;
  stale?: boolean;
}

export interface UiRetrievalResult extends Omit<
  UiRetrievalDocumentInput,
  'retrievalId' | 'projectId'
> {
  retrievalId: string;
  rank: number;
}

export interface UiDocumentExtraction {
  document: VektreUIDocumentV2;
  documentHash: string;
  structuralDigest: JsonValue;
  layoutFingerprints: JsonValue;
  retrievalDocuments: UiRetrievalDocumentInput[];
  assetIds: string[];
}
