import type { JobsOptions } from 'bullmq';

export const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 86_400, count: 1_000 },
  removeOnFail: { age: 604_800 },
};

export const heavyJobOptions: JobsOptions = {
  ...defaultJobOptions,
  attempts: 3,
  backoff: { type: 'exponential', delay: 15_000 },
};
