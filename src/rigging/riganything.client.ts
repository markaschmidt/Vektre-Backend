import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { outboundJson } from '../integrations/outbound-http.js';
import type { RigAnythingConfig } from '../config/riganything.config.js';
import type { WorkerRigStatus } from './models/rigging-job.model.js';

export interface WorkerCreateJobBody {
  inputUrl: string;
  outputUploadUrl: string;
  simplify: boolean;
  targetFaceCount: number;
}

export interface WorkerCreateJobResult {
  jobId: string;
  status: WorkerRigStatus;
}

export interface WorkerJobStatus {
  jobId: string;
  status: WorkerRigStatus;
  error?: string | null;
  simplify?: boolean;
  targetFaceCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

@Injectable()
export class RigAnythingClient {
  private readonly logger = new Logger(RigAnythingClient.name);

  constructor(private readonly config: ConfigService) {}

  private cfg(): RigAnythingConfig {
    return this.config.getOrThrow<RigAnythingConfig>('riganything');
  }

  assertConfigured(): void {
    const cfg = this.cfg();
    if (!cfg.enabled || !cfg.url || !cfg.apiKey) {
      throw new Error(
        'RigAnything is not configured (set RIGANYTHING_URL and RIGANYTHING_API_KEY)',
      );
    }
  }

  async createJob(
    body: WorkerCreateJobBody,
    opts: { requestId: string; userId: string; idempotencyKey: string },
  ): Promise<WorkerCreateJobResult> {
    this.assertConfigured();
    const cfg = this.cfg();
    const res = await outboundJson<WorkerCreateJobResult>({
      provider: 'riganything',
      url: `${cfg.url}/rig/jobs`,
      method: 'POST',
      headers: {
        'X-API-Key': cfg.apiKey,
        'X-Idempotency-Key': opts.idempotencyKey,
      },
      body,
      timeoutMs: cfg.requestTimeoutMs,
      requestId: opts.requestId,
      userId: opts.userId,
    });
    this.logger.log(
      JSON.stringify({
        event: 'riganything_job_created',
        requestId: opts.requestId,
        workerJobId: res.data.jobId,
        status: res.data.status,
      }),
    );
    return res.data;
  }

  async getJob(
    workerJobId: string,
    opts: { requestId: string; userId: string },
  ): Promise<WorkerJobStatus> {
    this.assertConfigured();
    const cfg = this.cfg();
    const res = await outboundJson<WorkerJobStatus>({
      provider: 'riganything',
      url: `${cfg.url}/rig/jobs/${encodeURIComponent(workerJobId)}`,
      method: 'GET',
      headers: {
        'X-API-Key': cfg.apiKey,
      },
      timeoutMs: cfg.requestTimeoutMs,
      requestId: opts.requestId,
      userId: opts.userId,
    });
    return res.data;
  }

  async health(): Promise<boolean> {
    const cfg = this.cfg();
    if (!cfg.url) return false;
    try {
      const res = await outboundJson<{ status?: string }>({
        provider: 'riganything',
        url: `${cfg.url}/health`,
        method: 'GET',
        headers: cfg.apiKey ? { 'X-API-Key': cfg.apiKey } : {},
        timeoutMs: Math.min(cfg.requestTimeoutMs, 10_000),
      });
      return res.data.status === 'ok' || res.status === 200;
    } catch {
      return false;
    }
  }
}
