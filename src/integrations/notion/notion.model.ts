export interface NotionOAuthTokenResponse {
  access_token: string;
  token_type: string;
  bot_id: string;
  workspace_id: string;
  workspace_name?: string;
  workspace_icon?: string;
  owner?: { type: string; user?: { id: string; name?: string } };
}

export interface NotionPage {
  id: string;
  url: string;
  title: string;
  lastEditedTime?: string;
  parentType?: string;
}

export interface NotionBlock {
  id: string;
  type: string;
  content?: Record<string, unknown>;
  hasChildren: boolean;
}

export interface NotionPageImportJob {
  requestId: string;
  userId: string;
  pageId: string;
  pageTitle: string;
  notionToken: string;
}
