export interface UiAgentTransitionJob {
  kind: 'transition';
  projectId: string;
  documentId: string;
  runId: string;
  stageExecutionId: string;
  trace?: { traceparent: string; tracestate?: string };
}

export interface UiAgentAssetResumeJob {
  kind: 'asset_resume';
  projectId: string;
  documentId: string;
  runId: string;
  sourceStageExecutionId: string;
  trace?: { traceparent: string; tracestate?: string };
}

export type UiAgentJob = UiAgentTransitionJob | UiAgentAssetResumeJob;
