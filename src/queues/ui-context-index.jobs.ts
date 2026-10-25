export interface UiSnapshotIndexJob {
  kind: 'snapshot';
  projectId: string;
  documentId: string;
  documentKey: string;
  documentType: 'gui_screen' | 'storyboard';
  snapshotId: string;
  stateVector: string;
  storageRef: string;
}

export type UiIndexSourceKind = 'comment' | 'memory' | 'asset';

export interface UiSourceIndexJob {
  kind: 'source';
  projectId: string;
  documentId?: string;
  sourceKind: UiIndexSourceKind;
  sourceId: string;
  sourceHash: string;
}

export type UiContextIndexJob = UiSnapshotIndexJob | UiSourceIndexJob;
