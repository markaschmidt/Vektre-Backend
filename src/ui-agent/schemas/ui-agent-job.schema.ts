import { z } from 'zod';

export const TraceCarrierSchema = z.strictObject({
  traceparent: z.string().min(1).max(256),
  tracestate: z.string().max(512).optional(),
});

export const UiAgentJobSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('transition'),
    projectId: z.string().min(1).max(256),
    documentId: z.string().min(1).max(256),
    runId: z.string().min(1).max(256),
    stageExecutionId: z.string().min(1).max(256),
    trace: TraceCarrierSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal('asset_resume'),
    projectId: z.string().min(1).max(256),
    documentId: z.string().min(1).max(256),
    runId: z.string().min(1).max(256),
    sourceStageExecutionId: z.string().min(1).max(256),
    trace: TraceCarrierSchema.optional(),
  }),
]);
