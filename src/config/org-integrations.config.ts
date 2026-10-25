import { registerAs } from '@nestjs/config';

export interface OrgIntegrationsConfig {
  githubClientId: string;
  githubClientSecret: string;
  githubRedirectUri: string;
  figmaClientId: string;
  figmaClientSecret: string;
  figmaRedirectUri: string;
  timeoutMs: number;
}

export const orgIntegrationsConfig = registerAs(
  'orgIntegrations',
  (): OrgIntegrationsConfig => ({
    githubClientId: process.env.GITHUB_ORG_CLIENT_ID?.trim() ?? '',
    githubClientSecret: process.env.GITHUB_ORG_CLIENT_SECRET?.trim() ?? '',
    githubRedirectUri: process.env.GITHUB_ORG_REDIRECT_URI?.trim() ?? '',
    figmaClientId: process.env.FIGMA_CLIENT_ID?.trim() ?? '',
    figmaClientSecret: process.env.FIGMA_CLIENT_SECRET?.trim() ?? '',
    figmaRedirectUri: process.env.FIGMA_REDIRECT_URI?.trim() ?? '',
    timeoutMs: Number.parseInt(
      process.env.ORG_INTEGRATION_TIMEOUT_MS ?? '15000',
      10,
    ),
  }),
);
