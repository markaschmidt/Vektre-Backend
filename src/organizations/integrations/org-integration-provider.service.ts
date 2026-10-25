import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import type { OrgIntegrationsConfig } from '../../config/org-integrations.config.js';
import type { OrganizationProvider } from '../../integrations/app-data.types.js';

type SecretPayload = Record<string, unknown>;

@Injectable()
export class OrgIntegrationProviderService {
  constructor(private readonly config: ConfigService) {}

  private get cfg(): OrgIntegrationsConfig {
    return this.config.getOrThrow<OrgIntegrationsConfig>('orgIntegrations');
  }

  async exchangeGitHubCode(
    code: string,
    redirectUri?: string,
  ): Promise<{ payload: SecretPayload; metadata: Record<string, unknown> }> {
    requireConfig(
      this.cfg.githubClientId,
      this.cfg.githubClientSecret,
      'GitHub organization OAuth',
    );
    const response = await this.requestJson<{
      access_token?: string;
      token_type?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    }>('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.cfg.githubClientId,
        client_secret: this.cfg.githubClientSecret,
        code,
        redirect_uri: (redirectUri ?? this.cfg.githubRedirectUri) || undefined,
      }),
    });
    if (!response.access_token) {
      throw new ServiceUnavailableException(
        response.error_description ?? response.error ?? 'GitHub OAuth failed',
      );
    }
    const identity = await this.requestJson<{ login: string; id: number }>(
      'https://api.github.com/user',
      { headers: githubHeaders(response.access_token) },
    );
    return {
      payload: { accessToken: response.access_token },
      metadata: {
        account: identity.login,
        accountId: identity.id,
        scope: response.scope ?? '',
        tokenType: response.token_type ?? 'bearer',
      },
    };
  }

  async exchangeFigmaCode(
    code: string,
    redirectUri?: string,
  ): Promise<{ payload: SecretPayload; metadata: Record<string, unknown> }> {
    requireConfig(
      this.cfg.figmaClientId,
      this.cfg.figmaClientSecret,
      'Figma OAuth',
    );
    const credentials = Buffer.from(
      `${this.cfg.figmaClientId}:${this.cfg.figmaClientSecret}`,
    ).toString('base64');
    const body = new URLSearchParams({
      redirect_uri: redirectUri ?? this.cfg.figmaRedirectUri,
      code,
      grant_type: 'authorization_code',
    });
    const token = await this.requestJson<{
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    }>('https://api.figma.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    const identity = await this.requestJson<{
      id: string;
      email: string;
      handle: string;
    }>('https://api.figma.com/v1/me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    return {
      payload: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: token.expires_in
          ? Date.now() + token.expires_in * 1000
          : undefined,
      },
      metadata: {
        account: identity.handle,
        accountId: identity.id,
        email: identity.email,
      },
    };
  }

  async validate(
    provider: OrganizationProvider,
    payload: SecretPayload,
  ): Promise<Record<string, unknown>> {
    switch (provider) {
      case 'github': {
        const identity = await this.requestJson<{ login: string; id: number }>(
          'https://api.github.com/user',
          { headers: githubHeaders(requiredString(payload.accessToken)) },
        );
        return { account: identity.login, accountId: identity.id };
      }
      case 'figma': {
        const identity = await this.requestJson<{
          id: string;
          email: string;
          handle: string;
        }>('https://api.figma.com/v1/me', {
          headers: {
            Authorization: `Bearer ${requiredString(payload.accessToken)}`,
          },
        });
        return {
          account: identity.handle,
          accountId: identity.id,
          email: identity.email,
        };
      }
      case 'perforce':
        await validatePerforce(payload, this.cfg.timeoutMs);
        return {
          serverUrl: requiredString(payload.serverUrl),
          username: requiredString(payload.username),
          workspace: optionalString(payload.workspace),
        };
      case 'git_lfs':
        await this.validateGitLfs(payload);
        return { endpoint: requiredString(payload.endpoint) };
    }
  }

  async listGitHubRepositories(payload: SecretPayload) {
    return this.requestJson<unknown[]>(
      'https://api.github.com/user/repos?per_page=100&sort=updated',
      { headers: githubHeaders(requiredString(payload.accessToken)) },
    );
  }

  async listFigmaTeamProjects(payload: SecretPayload, teamId: string) {
    return this.requestJson<Record<string, unknown>>(
      `https://api.figma.com/v1/teams/${encodeURIComponent(teamId)}/projects`,
      {
        headers: {
          Authorization: `Bearer ${requiredString(payload.accessToken)}`,
        },
      },
    );
  }

  async listFigmaProjectFiles(payload: SecretPayload, projectId: string) {
    return this.requestJson<Record<string, unknown>>(
      `https://api.figma.com/v1/projects/${encodeURIComponent(projectId)}/files`,
      {
        headers: {
          Authorization: `Bearer ${requiredString(payload.accessToken)}`,
        },
      },
    );
  }

  private async validateGitLfs(payload: SecretPayload): Promise<void> {
    const endpoint = requiredString(payload.endpoint);
    const token = optionalString(payload.token);
    const username = optionalString(payload.username);
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = username
        ? `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`
        : `Bearer ${token}`;
    }
    const response = await fetch(endpoint, {
      method: 'HEAD',
      headers,
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });
    if (
      response.status === 401 ||
      response.status === 403 ||
      response.status >= 500
    ) {
      throw new Error(
        `Git LFS endpoint validation failed (${response.status})`,
      );
    }
  }

  private async requestJson<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });
    const body = (await response.json().catch(() => ({}))) as T & {
      message?: string;
    };
    if (!response.ok) {
      throw new ServiceUnavailableException(
        body.message ??
          `Integration provider request failed (${response.status})`,
      );
    }
    return body;
  }
}

function githubHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function validatePerforce(
  payload: SecretPayload,
  timeoutMs: number,
): Promise<void> {
  const serverUrl = requiredString(payload.serverUrl);
  const username = requiredString(payload.username);
  const credential = requiredString(payload.credential);
  return new Promise((resolve, reject) => {
    execFile(
      'p4',
      ['-p', serverUrl, '-u', username, 'login', '-s'],
      {
        env: { ...process.env, P4PASSWD: credential },
        timeout: timeoutMs,
      },
      (error) => {
        if (error) {
          reject(
            new Error(
              error.code === 'ENOENT'
                ? 'Perforce CLI (p4) is not installed on the API worker'
                : `Perforce validation failed: ${error.message}`,
            ),
          );
          return;
        }
        resolve();
      },
    );
  });
}

function requireConfig(
  clientId: string,
  clientSecret: string,
  provider: string,
): void {
  if (!clientId || !clientSecret) {
    throw new ServiceUnavailableException(`${provider} is not configured`);
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Stored integration credential is incomplete');
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
