import { registerAs } from '@nestjs/config';

export interface OutboundProviderConfig {
  timeoutMs: number;
  maxRetries: number;
  backoffMs: number;
}

export interface ReplicateConfig extends OutboundProviderConfig {
  token: string;
  baseUrl: string;
  /** Replicate model slug for FLUX.2 concept art (e.g. black-forest-labs/flux-2-pro). */
  fluxModel: string;
}

export interface OpenAiConfig extends OutboundProviderConfig {
  apiKey: string;
  baseUrl: string;
  /** GPT Image model id (gpt-image-2, gpt-image-1, gpt-image-1-mini, …). */
  imageModel: string;
  /** Default quality for GPT Image generations. */
  imageQuality: 'low' | 'medium' | 'high' | 'auto';
  /** Default size for GPT Image generations. */
  imageSize: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
  /** Outbound timeout for low / medium / auto GPT Image runs. */
  imageTimeoutMs: number;
  /** Outbound timeout when quality is explicitly high (much slower). */
  imageHighTimeoutMs: number;
}

export interface OllamaConfig extends OutboundProviderConfig {
  baseUrl: string;
  enabled: boolean;
}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
}

export interface NotionConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  timeoutMs: number;
}

export interface GenerationPricingConfig {
  openaiTextInputPer1M: number;
  openaiImageInputPer1M: number;
  openaiImageOutputPer1M: number;
  openaiInputBlendedPer1M: number;
  replicateDefaultUsdPerSecond: number;
  replicateModelUsdPerSecond: Record<string, number>;
}

export interface OutboundConfig {
  replicate: ReplicateConfig;
  openai: OpenAiConfig;
  ollama: OllamaConfig;
  google: GoogleConfig;
  notion: NotionConfig;
  generationPricing: GenerationPricingConfig;
}

/**
 * Typed outbound provider configuration. Registered under the 'outbound' namespace.
 * All secrets sourced from environment variables; see .env for local development names.
 * Production should inject variables via the deployment secret manager.
 *
 * The app will throw at startup when required variables are missing.
 */
export const outboundConfig = registerAs('outbound', (): OutboundConfig => {
  const replicateToken = process.env['VEKTRE_REPLICATE_TOKEN'];
  const openaiApiKey = process.env['OPENAI_API_KEY'];
  const googleClientId = process.env['GOOGLE_CLIENT_ID'];
  const googleClientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  const notionClientId = process.env['NOTION_CLIENT_ID'];
  const notionClientSecret = process.env['NOTION_CLIENT_SECRET'];

  // Fail fast on missing required secrets so deployment errors surface immediately.
  const missing: string[] = [];
  if (!replicateToken) missing.push('VEKTRE_REPLICATE_TOKEN');
  if (!openaiApiKey) missing.push('OPENAI_API_KEY');
  if (!googleClientId) missing.push('GOOGLE_CLIENT_ID');
  if (!googleClientSecret) missing.push('GOOGLE_CLIENT_SECRET');
  if (!notionClientId) missing.push('NOTION_CLIENT_ID');
  if (!notionClientSecret) missing.push('NOTION_CLIENT_SECRET');

  if (missing.length > 0) {
    throw new Error(
      `Missing required outbound provider environment variables: ${missing.join(', ')}`,
    );
  }

  const ollamaBaseUrl = process.env['OLLAMA_BASE_URL'];

  return {
    replicate: {
      token: replicateToken!,
      baseUrl: process.env['REPLICATE_BASE_URL'] ?? 'https://api.replicate.com',
      timeoutMs: Number(process.env['REPLICATE_TIMEOUT_MS'] ?? 120_000),
      maxRetries: Number(process.env['REPLICATE_MAX_RETRIES'] ?? 5),
      backoffMs: Number(process.env['REPLICATE_BACKOFF_MS'] ?? 2_000),
      fluxModel:
        process.env['REPLICATE_FLUX_MODEL'] ??
        'black-forest-labs/flux-2-pro',
    },
    openai: {
      apiKey: openaiApiKey!,
      baseUrl: process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com',
      timeoutMs: Number(process.env['OPENAI_TIMEOUT_MS'] ?? 90_000),
      maxRetries: Number(process.env['OPENAI_MAX_RETRIES'] ?? 3),
      backoffMs: Number(process.env['OPENAI_BACKOFF_MS'] ?? 1_000),
      imageModel: process.env['OPENAI_IMAGE_MODEL'] ?? 'gpt-image-2',
      imageQuality: parseOpenAiImageQuality(
        process.env['OPENAI_IMAGE_QUALITY'],
      ),
      imageSize: parseOpenAiImageSize(process.env['OPENAI_IMAGE_SIZE']),
      imageTimeoutMs: Number(
        process.env['OPENAI_IMAGE_TIMEOUT_MS'] ?? 180_000,
      ),
      imageHighTimeoutMs: Number(
        process.env['OPENAI_IMAGE_HIGH_TIMEOUT_MS'] ?? 600_000,
      ),
    },
    ollama: {
      baseUrl: ollamaBaseUrl ?? 'http://localhost:11434',
      enabled: Boolean(ollamaBaseUrl),
      timeoutMs: Number(process.env['OLLAMA_TIMEOUT_MS'] ?? 120_000),
      maxRetries: Number(process.env['OLLAMA_MAX_RETRIES'] ?? 2),
      backoffMs: Number(process.env['OLLAMA_BACKOFF_MS'] ?? 1_000),
    },
    google: {
      clientId: googleClientId!,
      clientSecret: googleClientSecret!,
      timeoutMs: Number(process.env['GOOGLE_TIMEOUT_MS'] ?? 30_000),
    },
    notion: {
      clientId: notionClientId!,
      clientSecret: notionClientSecret!,
      redirectUri:
        process.env['NOTION_REDIRECT_URI'] ??
        'http://localhost:3001/integrations/notion/oauth/callback',
      timeoutMs: Number(process.env['NOTION_TIMEOUT_MS'] ?? 30_000),
    },
    generationPricing: {
      // GPT Image list prices ($ / 1M tokens) — override via env as vendors change rates.
      openaiTextInputPer1M: Number(
        process.env['COST_OPENAI_TEXT_INPUT_PER_1M'] ?? 5,
      ),
      openaiImageInputPer1M: Number(
        process.env['COST_OPENAI_IMAGE_INPUT_PER_1M'] ?? 8,
      ),
      openaiImageOutputPer1M: Number(
        process.env['COST_OPENAI_IMAGE_OUTPUT_PER_1M'] ?? 30,
      ),
      openaiInputBlendedPer1M: Number(
        process.env['COST_OPENAI_INPUT_BLENDED_PER_1M'] ?? 5,
      ),
      // Replicate has no per-prediction $ field; estimate from predict_time × $/sec.
      replicateDefaultUsdPerSecond: Number(
        process.env['COST_REPLICATE_USD_PER_SEC'] ?? 0.002,
      ),
      replicateModelUsdPerSecond: parseUsdPerSecondMap(
        process.env['COST_REPLICATE_MODEL_USD_PER_SEC_JSON'],
      ),
    },
  };
});

function parseUsdPerSecondMap(raw: string | undefined): Record<string, number> {
  const defaults: Record<string, number> = {
    'tencent/hunyuan-3d-3.1': 0.002,
    'tencent/hunyuan3d-2mv': 0.001,
    'black-forest-labs/flux-2-pro': 0.003,
  };
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out = { ...defaults };
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) out[k] = n;
    }
    return out;
  } catch {
    return defaults;
  }
}

function parseOpenAiImageQuality(
  raw: string | undefined,
): OpenAiConfig['imageQuality'] {
  const allowed = new Set(['low', 'medium', 'high', 'auto']);
  if (raw && allowed.has(raw)) return raw as OpenAiConfig['imageQuality'];
  return 'medium';
}

function parseOpenAiImageSize(raw: string | undefined): OpenAiConfig['imageSize'] {
  const allowed = new Set([
    '1024x1024',
    '1024x1536',
    '1536x1024',
    'auto',
  ]);
  if (raw && allowed.has(raw)) return raw as OpenAiConfig['imageSize'];
  return '1024x1024';
}
