/**
 * Hunyuan 3D generation parameters for Replicate (`tencent/hunyuan-3d-3.1`).
 * Canvas sends camelCase on `config`; direct API may use the same or snake_case.
 */

/** Values accepted by Replicate `tencent/hunyuan-3d-3.1` (not `LowPoly`). */
export type HunyuanGenerateType = 'Normal' | 'Geometry';

export type HunyuanQualityTier = 'prop' | 'hero';

export interface Hunyuan3dGenerationOptions {
  face_count: number;
  generate_type: HunyuanGenerateType;
  enable_pbr: boolean;
}

/** Default matches desktop Canvas "Prop" preset (not Hero / 500k). */
export const HUNYUAN_3D_DEFAULT_OPTIONS: Hunyuan3dGenerationOptions = {
  face_count: 40_000,
  generate_type: 'Geometry',
  enable_pbr: false,
};

const TIER_PRESETS: Record<HunyuanQualityTier, Hunyuan3dGenerationOptions> = {
  prop: HUNYUAN_3D_DEFAULT_OPTIONS,
  hero: {
    face_count: 500_000,
    generate_type: 'Normal',
    enable_pbr: false,
  },
};

const MIN_FACE_COUNT = 40_000;
const MAX_FACE_COUNT = 1_500_000;

export function normalizeHunyuanGenerateType(
  value: string,
): HunyuanGenerateType | undefined {
  const trimmed = value.trim();
  if (trimmed === 'Normal' || trimmed === 'Geometry') return trimmed;
  const lower = trimmed.toLowerCase();
  if (lower === 'normal') return 'Normal';
  // Desktop Canvas uses "LowPoly" for the Prop preset; Replicate expects "Geometry".
  if (lower === 'geometry' || lower === 'lowpoly' || lower === 'low_poly') {
    return 'Geometry';
  }
  return undefined;
}

export function normalizeHunyuanQualityTier(
  value: string,
): HunyuanQualityTier | undefined {
  const lower = value.trim().toLowerCase();
  if (lower === 'prop' || lower === 'hero') return lower;
  return undefined;
}

function readBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

function clampFaceCount(value: number): number {
  return Math.min(MAX_FACE_COUNT, Math.max(MIN_FACE_COUNT, Math.round(value)));
}

/**
 * Resolve Replicate Hunyuan input options from canvas action config or direct API body.
 *
 * Precedence:
 * 1. Explicit `faceCount` / `generateType` / `enablePbr` (or snake_case equivalents)
 * 2. `customFaceCount` when `useCustomFaceCount` is true
 * 3. `qualityTier` preset (`prop` | `hero`)
 * 4. Prop defaults (40k / Geometry — desktop may send generateType "LowPoly")
 */
export function resolveHunyuan3dOptions(
  config?: Record<string, unknown>,
): Hunyuan3dGenerationOptions {
  if (!config) {
    return { ...HUNYUAN_3D_DEFAULT_OPTIONS };
  }

  const tierRaw = readString(config.qualityTier ?? config.quality_tier);
  const tier = tierRaw ? normalizeHunyuanQualityTier(tierRaw) : undefined;
  const preset = tier ? TIER_PRESETS[tier] : undefined;
  const base = preset ?? HUNYUAN_3D_DEFAULT_OPTIONS;

  const useCustom =
    config.useCustomFaceCount === true || config.use_custom_face_count === true;
  const customFace = readNumber(
    config.customFaceCount ?? config.custom_face_count,
  );

  const explicitFace = readNumber(config.faceCount ?? config.face_count);
  const face_count = clampFaceCount(
    explicitFace ?? (useCustom && customFace != null ? customFace : base.face_count),
  );

  const generateTypeRaw = readString(config.generateType ?? config.generate_type);
  const parsedGenerateType = generateTypeRaw
    ? normalizeHunyuanGenerateType(generateTypeRaw)
    : undefined;
  const generate_type = parsedGenerateType ?? base.generate_type;

  const enable_pbr =
    readBool(config.enablePbr ?? config.enable_pbr) ?? base.enable_pbr;

  return { face_count, generate_type, enable_pbr };
}

export function isValidHunyuanGenerateType(value: string): boolean {
  return normalizeHunyuanGenerateType(value) !== undefined;
}

export function isValidHunyuanQualityTier(value: string): boolean {
  return normalizeHunyuanQualityTier(value) !== undefined;
}
