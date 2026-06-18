import { registerAs } from '@nestjs/config';

export interface OutboundProviderConfig {
  timeoutMs: number;
  maxRetries: number;
  backoffMs: number;
}

export interface ReplicateConfig extends OutboundProviderConfig {
  token: string;
  baseUrl: string;
}

export interface OpenAiConfig extends OutboundProviderConfig {
  apiKey: string;
  baseUrl: string;
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

export interface OutboundConfig {
  replicate: ReplicateConfig;
  openai: OpenAiConfig;
  ollama: OllamaConfig;
  google: GoogleConfig;
  notion: NotionConfig;
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
    },
    openai: {
      apiKey: openaiApiKey!,
      baseUrl: process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com',
      timeoutMs: Number(process.env['OPENAI_TIMEOUT_MS'] ?? 90_000),
      maxRetries: Number(process.env['OPENAI_MAX_RETRIES'] ?? 3),
      backoffMs: Number(process.env['OPENAI_BACKOFF_MS'] ?? 1_000),
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
  };
});
