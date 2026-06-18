import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotionConfig } from '../../config/outbound.config.js';
import { outboundJson } from '../outbound-http.js';
import type {
  NotionOAuthTokenResponse,
  NotionPage,
  NotionBlock,
} from './notion.model.js';

const PROVIDER = 'notion';
const NOTION_VERSION = '2022-06-28';
const NOTION_BASE = 'https://api.notion.com';

@Injectable()
export class NotionService {
  private readonly logger = new Logger(NotionService.name);

  constructor(private readonly config: ConfigService) {}

  private get cfg(): NotionConfig {
    return this.config.get<NotionConfig>('outbound.notion')!;
  }

  private apiHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Exchange an OAuth authorization code for an access token.
   * NOTION_CLIENT_SECRET stays server-side and is never returned to the client.
   */
  async exchangeOAuthCode(opts: {
    code: string;
    redirectUri?: string;
  }): Promise<NotionOAuthTokenResponse> {
    const { code, redirectUri = this.cfg.redirectUri } = opts;

    const credentials = Buffer.from(
      `${this.cfg.clientId}:${this.cfg.clientSecret}`,
    ).toString('base64');

    const { data } = await outboundJson<NotionOAuthTokenResponse>({
      provider: PROVIDER,
      url: `${NOTION_BASE}/v1/oauth/token`,
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      },
      timeoutMs: this.cfg.timeoutMs,
    });

    this.logger.log(
      JSON.stringify({
        event: 'notion_oauth_exchange_complete',
        workspaceId: data.workspace_id,
      }),
    );

    return data;
  }

  /**
   * Search for pages and databases in the connected workspace.
   */
  async search(opts: {
    accessToken: string;
    query: string;
    filter?: 'page' | 'database';
    userId: string;
  }): Promise<NotionPage[]> {
    const body: Record<string, unknown> = { query: opts.query };
    if (opts.filter) {
      body['filter'] = { value: opts.filter, property: 'object' };
    }

    const { data } = await outboundJson<{
      results: {
        id: string;
        url: string;
        object: string;
        last_edited_time?: string;
        parent?: { type: string };
        properties?: Record<string, { title?: { plain_text: string }[] }>;
      }[];
    }>({
      provider: PROVIDER,
      url: `${NOTION_BASE}/v1/search`,
      method: 'POST',
      headers: this.apiHeaders(opts.accessToken),
      body,
      timeoutMs: this.cfg.timeoutMs,
      userId: opts.userId,
    });

    return (data.results ?? []).map((r) => ({
      id: r.id,
      url: r.url,
      title: extractTitle(r),
      lastEditedTime: r.last_edited_time,
      parentType: r.parent?.type,
    }));
  }

  /**
   * Retrieve a page's block children.
   */
  async getPageBlocks(opts: {
    accessToken: string;
    pageId: string;
    userId: string;
  }): Promise<NotionBlock[]> {
    const { data } = await outboundJson<{
      results: {
        id: string;
        type: string;
        [key: string]: unknown;
        has_children: boolean;
      }[];
    }>({
      provider: PROVIDER,
      url: `${NOTION_BASE}/v1/blocks/${opts.pageId}/children`,
      headers: this.apiHeaders(opts.accessToken),
      timeoutMs: this.cfg.timeoutMs,
      userId: opts.userId,
    });

    return (data.results ?? []).map((b) => ({
      id: b.id,
      type: b.type,
      content: b[b.type] as Record<string, unknown> | undefined,
      hasChildren: b.has_children,
    }));
  }

  /**
   * Create a new page in a Notion workspace under a given parent.
   */
  async createPage(opts: {
    accessToken: string;
    parentId: string;
    title: string;
    content?: string;
    userId: string;
  }): Promise<{ pageId: string; url: string }> {
    const { data } = await outboundJson<{ id: string; url: string }>({
      provider: PROVIDER,
      url: `${NOTION_BASE}/v1/pages`,
      method: 'POST',
      headers: this.apiHeaders(opts.accessToken),
      body: {
        parent: { page_id: opts.parentId },
        properties: {
          title: { title: [{ text: { content: opts.title } }] },
        },
        children: opts.content
          ? [
              {
                object: 'block',
                type: 'paragraph',
                paragraph: {
                  rich_text: [{ text: { content: opts.content } }],
                },
              },
            ]
          : [],
      },
      timeoutMs: this.cfg.timeoutMs,
      userId: opts.userId,
    });

    this.logger.log(
      JSON.stringify({
        event: 'notion_page_created',
        pageId: data.id,
        userId: opts.userId,
      }),
    );

    return { pageId: data.id, url: data.url };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractTitle(result: {
  properties?: Record<string, { title?: { plain_text: string }[] }>;
}): string {
  const props = result.properties ?? {};
  for (const key of ['title', 'Title', 'Name']) {
    const titleProp = props[key]?.title;
    if (titleProp && titleProp.length > 0) {
      return titleProp.map((t) => t.plain_text).join('');
    }
  }
  return 'Untitled';
}
