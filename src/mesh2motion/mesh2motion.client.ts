import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { outboundBinary, outboundJson } from '../integrations/outbound-http.js';
import { ProviderError } from '../integrations/provider-error.model.js';
import type { Mesh2MotionConfig } from '../config/mesh2motion.config.js';
import type {
  Mesh2MotionSkeletonType,
  WorkerMesh2MotionStatus,
} from './models/mesh2motion-job.model.js';

export interface AnimatorSkeletonEntry {
  skeleton_type: string;
  display_name: string;
  animations: string[];
}

export interface AnimatorSkeletonsResponse {
  skeletons: AnimatorSkeletonEntry[];
}

export interface AnimatorCreateJobOptions {
  skeleton_type: Mesh2MotionSkeletonType;
  animations?: string[] | 'all';
  bone_overrides?: Record<string, unknown>;
  bone_naming?: 'default' | 'mixamo';
  mirror?: boolean;
  export_contents?: 'full' | 'skeleton';
  head_weight_correction?: boolean;
  hand_skeleton?: string;
}

interface AnimatorCreateJobResponse {
  job_id: string;
  status: string;
}

interface AnimatorJobStatusResponse {
  job_id: string;
  status: string;
  error?: string | null;
  animations?: string[];
  bone_count?: number;
  skeleton_type?: string;
  skeleton_scale?: number;
  duration_ms?: number;
  result_url?: string;
}

export interface Mesh2MotionWorkerCreateJobResult {
  jobId: string;
  status: WorkerMesh2MotionStatus;
}

export interface Mesh2MotionWorkerJobStatus {
  jobId: string;
  status: WorkerMesh2MotionStatus;
  rawStatus: string;
  error?: string | null;
  skeletonType?: Mesh2MotionSkeletonType;
  animationNames?: string[] | null;
  boneCount?: number;
  durationMs?: number;
}

@Injectable()
export class Mesh2MotionClient {
  private readonly logger = new Logger(Mesh2MotionClient.name);

  constructor(private readonly config: ConfigService) {}

  private cfg(): Mesh2MotionConfig {
    return this.config.getOrThrow<Mesh2MotionConfig>('mesh2motion');
  }

  private authHeaders(): Record<string, string> {
    const apiKey = this.cfg().apiKey;
    return apiKey ? { 'X-API-Key': apiKey } : {};
  }

  assertConfigured(): void {
    const cfg = this.cfg();
    if (!cfg.enabled || !cfg.url) {
      throw new Error(
        'Animator is not configured (set ANIMATOR_URL or ANIMATOR_HOST)',
      );
    }
  }

  async listSkeletons(): Promise<AnimatorSkeletonsResponse> {
    this.assertConfigured();
    const cfg = this.cfg();
    const res = await outboundJson<AnimatorSkeletonsResponse>({
      provider: 'animator',
      url: `${cfg.url}/v1/skeletons`,
      method: 'GET',
      headers: this.authHeaders(),
      timeoutMs: cfg.requestTimeoutMs,
    });
    return res.data;
  }

  async createJob(
    fileBytes: Buffer,
    filename: string,
    options: AnimatorCreateJobOptions,
    opts: { requestId: string; userId: string },
  ): Promise<Mesh2MotionWorkerCreateJobResult> {
    this.assertConfigured();
    const cfg = this.cfg();

    const formData = new FormData();
    formData.append(
      'file',
      new Blob([new Uint8Array(fileBytes)], { type: 'model/gltf-binary' }),
      filename.endsWith('.glb') ? filename : `${filename}.glb`,
    );
    formData.append('options', JSON.stringify(options));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), cfg.requestTimeoutMs);

    let response: Response;
    try {
      response = await fetch(`${cfg.url}/v1/jobs`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: formData,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'AbortError') {
        throw ProviderError.retryable(
          'animator',
          `Animator create timed out after ${cfg.requestTimeoutMs}ms`,
        );
      }
      throw ProviderError.retryable('animator', `Network error: ${String(err)}`);
    } finally {
      clearTimeout(timeoutId);
    }

    const text = await response.text();
    if (!response.ok) {
      throw ProviderError.permanent(
        'animator',
        `Animator create failed (${response.status}): ${text.slice(0, 400)}`,
        response.status,
      );
    }

    let data: AnimatorCreateJobResponse;
    try {
      data = JSON.parse(text) as AnimatorCreateJobResponse;
    } catch {
      throw ProviderError.permanent(
        'animator',
        `Invalid JSON from animator create: ${text.slice(0, 200)}`,
      );
    }

    const jobId = data.job_id;
    const status = normalizeAnimatorStatus(data.status);

    this.logger.log(
      JSON.stringify({
        event: 'animator_job_created',
        requestId: opts.requestId,
        workerJobId: jobId,
        status,
        skeletonType: options.skeleton_type,
      }),
    );

    return { jobId, status };
  }

  async getJob(
    workerJobId: string,
    opts: { requestId: string; userId: string },
  ): Promise<Mesh2MotionWorkerJobStatus> {
    this.assertConfigured();
    const cfg = this.cfg();
    const res = await outboundJson<AnimatorJobStatusResponse>({
      provider: 'animator',
      url: `${cfg.url}/v1/jobs/${encodeURIComponent(workerJobId)}`,
      method: 'GET',
      headers: this.authHeaders(),
      timeoutMs: cfg.requestTimeoutMs,
      requestId: opts.requestId,
      userId: opts.userId,
    });

    const raw = res.data;
    return {
      jobId: raw.job_id,
      status: normalizeAnimatorStatus(raw.status),
      rawStatus: raw.status,
      error: raw.error ?? null,
      skeletonType: raw.skeleton_type as Mesh2MotionSkeletonType | undefined,
      animationNames: raw.animations ?? null,
      boneCount: raw.bone_count,
      durationMs: raw.duration_ms,
    };
  }

  async downloadResult(
    workerJobId: string,
    opts: { requestId: string; userId: string },
  ): Promise<Buffer> {
    this.assertConfigured();
    const cfg = this.cfg();
    return outboundBinary({
      provider: 'animator',
      url: `${cfg.url}/v1/jobs/${encodeURIComponent(workerJobId)}/result`,
      method: 'GET',
      headers: this.authHeaders(),
      timeoutMs: Math.max(cfg.requestTimeoutMs, 120_000),
      requestId: opts.requestId,
      userId: opts.userId,
    });
  }

  async uploadToSignedUrl(uploadUrl: string, bytes: Buffer): Promise<void> {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'model/gltf-binary',
        'x-upsert': 'true',
      },
      body: new Uint8Array(bytes),
    });
    if (!response.ok) {
      const text = await response.text();
      throw ProviderError.permanent(
        'animator',
        `Supabase upload failed (${response.status}): ${text.slice(0, 300)}`,
        response.status,
      );
    }
  }

  async health(): Promise<boolean> {
    const cfg = this.cfg();
    if (!cfg.url) return false;
    try {
      const res = await outboundJson<{ status?: string }>({
        provider: 'animator',
        url: `${cfg.url}/health`,
        method: 'GET',
        headers: this.authHeaders(),
        timeoutMs: Math.min(cfg.requestTimeoutMs, 10_000),
      });
      return res.data.status === 'ok' || res.status === 200;
    } catch {
      return false;
    }
  }
}

function normalizeAnimatorStatus(raw: string): WorkerMesh2MotionStatus {
  switch (raw.toLowerCase()) {
    case 'queued':
      return 'queued';
    case 'downloading':
      return 'downloading';
    case 'fitting':
    case 'skinning':
      return 'fitting';
    case 'animating':
      return 'animating';
    case 'uploading':
      return 'uploading';
    case 'running':
    case 'processing':
      return 'fitting';
    case 'succeeded':
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return 'fitting';
  }
}
