/**
 * Compose canvas / storyboard rich text into a clean image-model prompt.
 *
 * Desktop clients may send TipTip/ProseMirror JSON dumps, HTML fragments, or
 * markdown from storyboard sections. Image models want plain descriptive
 * prose — this normalizes without inventing content.
 */

export interface ComposeImagePromptOptions {
  /** Explicit override from the action node config (wins over connected text). */
  configPrompt?: string;
  /** Connected port texts (storyboard sections, freeform text nodes). */
  connectedTexts?: string[];
  /** When false, ignore connectedTexts unless configPrompt is empty and no other source exists. */
  useConnectedSectionText?: boolean;
  style?: string;
  /** Soft cap after composition (provider-specific hard limits still apply). */
  maxLength?: number;
}

const DEFAULT_MAX_LENGTH = 4_000;

/**
 * Strip HTML tags, collapse whitespace, and drop empty lines.
 */
export function richTextToPlainPrompt(raw: string): string {
  if (!raw) return '';

  let text = raw;

  // TipTap / ProseMirror JSON: extract text nodes when the payload looks like a doc.
  const trimmed = text.trim();
  if (
    (trimmed.startsWith('{') && trimmed.includes('"type"')) ||
    (trimmed.startsWith('[') && trimmed.includes('"type"'))
  ) {
    const extracted = extractTextFromProseMirrorJson(trimmed);
    if (extracted) text = extracted;
  }

  // HTML → text
  text = text
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n')
    .replace(/<\/\s*div\s*>/gi, '\n')
    .replace(/<\/\s*li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  // Common markdown noise
  text = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1');

  // Decode a few common entities
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractTextFromProseMirrorJson(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const chunks: string[] = [];
    walkProseMirror(parsed, chunks);
    const joined = chunks.join(' ').replace(/\s+/g, ' ').trim();
    return joined || null;
  } catch {
    return null;
  }
}

function walkProseMirror(node: unknown, out: string[]): void {
  if (node == null) return;
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) walkProseMirror(child, out);
    return;
  }
  if (typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (typeof obj.text === 'string') out.push(obj.text);
  if (obj.content) walkProseMirror(obj.content, out);
}

/**
 * Build the final prompt sent to GPT Image / FLUX.2.
 */
export function composeImagePrompt(opts: ComposeImagePromptOptions): string {
  const maxLength = opts.maxLength ?? DEFAULT_MAX_LENGTH;
  const useConnected = opts.useConnectedSectionText !== false;

  const configPrompt = richTextToPlainPrompt(opts.configPrompt ?? '');
  const connected = (opts.connectedTexts ?? [])
    .map((t) => richTextToPlainPrompt(t))
    .filter(Boolean);

  let body = '';
  if (configPrompt) {
    body = configPrompt;
  } else if (useConnected && connected.length > 0) {
    body = connected.join('\n\n');
  }

  const style = opts.style?.trim();
  if (style && body) {
    body = `${body}\n\nStyle: ${style}`;
  } else if (style && !body) {
    body = `Style: ${style}`;
  }

  if (body.length <= maxLength) return body;
  return `${body.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
