/** Replicate model slugs for Hunyuan 3D variants used by Vektre. */
export const HUNYUAN_REPLICATE_MODEL_3_1 = 'tencent/hunyuan-3d-3.1' as const;
export const HUNYUAN_REPLICATE_MODEL_2MV = 'tencent/hunyuan3d-2mv' as const;

export const HUNYUAN_MODEL_VARIANTS = ['3.1', '2mv'] as const;
export type HunyuanModelVariant = (typeof HUNYUAN_MODEL_VARIANTS)[number];

export const DEFAULT_HUNYUAN_MODEL_VARIANT: HunyuanModelVariant = '3.1';

export function replicateModelIdForVariant(
  variant: HunyuanModelVariant,
): string {
  return variant === '2mv'
    ? HUNYUAN_REPLICATE_MODEL_2MV
    : HUNYUAN_REPLICATE_MODEL_3_1;
}

export function isValidHunyuanModelVariant(value: string): boolean {
  return parseHunyuanModelVariant(value) !== undefined;
}

export function parseHunyuanModelVariant(
  value: string,
): HunyuanModelVariant | undefined {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === '2mv' ||
    normalized === 'hunyuan3d-2mv' ||
    normalized === HUNYUAN_REPLICATE_MODEL_2MV
  ) {
    return '2mv';
  }
  if (
    normalized === '3.1' ||
    normalized === '3_1' ||
    normalized === 'hunyuan-3d-3.1' ||
    normalized === HUNYUAN_REPLICATE_MODEL_3_1
  ) {
    return '3.1';
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

/**
 * Resolve which Hunyuan Replicate model to call.
 *
 * Precedence:
 * 1. Explicit `config.hunyuanModel` / `config.modelVariant` / `config.replicateModel`
 * 2. Auto: ≥2 multiview asset inputs → `2mv`
 * 3. Default `3.1`
 */
export function resolveHunyuanModelVariant(
  config?: Record<string, unknown>,
  multiviewAssetCount = 0,
): HunyuanModelVariant {
  const explicit =
    readString(config?.hunyuanModel) ??
    readString(config?.modelVariant) ??
    readString(config?.replicateModel);

  if (explicit) {
    const parsed = parseHunyuanModelVariant(explicit);
    if (parsed) return parsed;
  }

  if (multiviewAssetCount >= 2) {
    return '2mv';
  }

  return DEFAULT_HUNYUAN_MODEL_VARIANT;
}

export type HunyuanMultiviewPort = 'front' | 'back' | 'left' | 'right';

export const HUNYUAN_MULTIVIEW_PORTS: HunyuanMultiviewPort[] = [
  'front',
  'back',
  'left',
  'right',
];

export type HunyuanMultiviewAssetIds = Partial<
  Record<HunyuanMultiviewPort, string>
>;

export type HunyuanMultiviewUrls = Partial<Record<HunyuanMultiviewPort, string>>;

export function countMultiviewAssets(
  ids: HunyuanMultiviewAssetIds | HunyuanMultiviewUrls,
): number {
  return HUNYUAN_MULTIVIEW_PORTS.filter((p) => Boolean(ids[p]?.trim())).length;
}

export function normalizeMultiviewImageUrls(
  raw?: Partial<Record<HunyuanMultiviewPort, string | undefined>> | null,
): HunyuanMultiviewUrls {
  const out: HunyuanMultiviewUrls = {};
  if (!raw) return out;
  for (const port of HUNYUAN_MULTIVIEW_PORTS) {
    const value = raw[port];
    if (typeof value === 'string' && value.trim()) {
      out[port] = value.trim();
    }
  }
  return out;
}

export function resolveMultiviewAssetIds(
  config: Record<string, unknown>,
  assets: Array<{ portId?: string; assetId: string }>,
): HunyuanMultiviewAssetIds {
  const fromPorts: HunyuanMultiviewAssetIds = {};
  for (const port of HUNYUAN_MULTIVIEW_PORTS) {
    const match = assets.find((a) => a.portId === port);
    if (match?.assetId) fromPorts[port] = match.assetId;
  }

  const fromConfig = readMultiviewAssetIdsFromConfig(config);
  return { ...fromConfig, ...fromPorts };
}

function readMultiviewAssetIdsFromConfig(
  config: Record<string, unknown>,
): HunyuanMultiviewAssetIds {
  const out: HunyuanMultiviewAssetIds = {};
  const nested =
    config.multiviewAssetIds ??
    config.multiview_asset_ids ??
    config.multiviewAssets;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    for (const port of HUNYUAN_MULTIVIEW_PORTS) {
      const value = (nested as Record<string, unknown>)[port];
      if (typeof value === 'string' && value.trim()) {
        out[port] = value.trim();
      }
    }
  }
  for (const port of HUNYUAN_MULTIVIEW_PORTS) {
    const key = `${port}AssetId`;
    const snake = `${port}_asset_id`;
    const direct = config[key] ?? config[snake];
    if (typeof direct === 'string' && direct.trim()) {
      out[port] = direct.trim();
    }
  }
  return out;
}
