/**
 * Replicate input options for `tencent/hunyuan3d-2mv`.
 * Canvas sends camelCase on `config`; direct API may use snake_case.
 */

export interface Hunyuan2mvGenerationOptions {
  target_face_num: number;
  octree_resolution: number;
  steps: number;
  guidance_scale: number;
  remove_background: boolean;
  randomize_seed: boolean;
  seed?: number;
  file_type: 'glb' | 'obj' | 'fbx' | 'usdz';
}

export const HUNYUAN_2MV_DEFAULT_OPTIONS: Hunyuan2mvGenerationOptions = {
  target_face_num: 10_000,
  octree_resolution: 256,
  steps: 30,
  guidance_scale: 5,
  remove_background: true,
  randomize_seed: true,
  file_type: 'glb',
};

const MIN_TARGET_FACE_NUM = 100;
const MAX_TARGET_FACE_NUM = 1_000_000;

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

function clampTargetFaceNum(value: number): number {
  return Math.min(
    MAX_TARGET_FACE_NUM,
    Math.max(MIN_TARGET_FACE_NUM, Math.round(value)),
  );
}

function normalizeFileType(value: string): Hunyuan2mvGenerationOptions['file_type'] | undefined {
  const lower = value.trim().toLowerCase();
  if (lower === 'glb' || lower === 'obj' || lower === 'fbx' || lower === 'usdz') {
    return lower;
  }
  return undefined;
}

export function resolveHunyuan2mvOptions(
  config?: Record<string, unknown>,
): Hunyuan2mvGenerationOptions {
  if (!config) {
    return { ...HUNYUAN_2MV_DEFAULT_OPTIONS };
  }

  const targetRaw =
    readNumber(config.targetFaceNum ?? config.target_face_num) ??
    readNumber(config.faceCount ?? config.face_count);
  const target_face_num = clampTargetFaceNum(
    targetRaw ?? HUNYUAN_2MV_DEFAULT_OPTIONS.target_face_num,
  );

  const octreeRaw = readNumber(
    config.octreeResolution ?? config.octree_resolution,
  );
  const octree_resolution =
    octreeRaw != null
      ? Math.min(512, Math.max(16, Math.round(octreeRaw)))
      : HUNYUAN_2MV_DEFAULT_OPTIONS.octree_resolution;

  const stepsRaw = readNumber(config.steps);
  const steps =
    stepsRaw != null
      ? Math.min(100, Math.max(1, Math.round(stepsRaw)))
      : HUNYUAN_2MV_DEFAULT_OPTIONS.steps;

  const guidanceRaw = readNumber(config.guidanceScale ?? config.guidance_scale);
  const guidance_scale =
    guidanceRaw ?? HUNYUAN_2MV_DEFAULT_OPTIONS.guidance_scale;

  const remove_background =
    readBool(config.removeBackground ?? config.remove_background) ??
    HUNYUAN_2MV_DEFAULT_OPTIONS.remove_background;

  const randomize_seed =
    readBool(config.randomizeSeed ?? config.randomize_seed) ??
    HUNYUAN_2MV_DEFAULT_OPTIONS.randomize_seed;

  const seedRaw = readNumber(config.seed);
  const seed = seedRaw != null ? Math.round(seedRaw) : undefined;

  const fileTypeRaw = readString(config.fileType ?? config.file_type);
  const parsedFileType = fileTypeRaw
    ? normalizeFileType(fileTypeRaw)
    : undefined;
  const file_type = parsedFileType ?? HUNYUAN_2MV_DEFAULT_OPTIONS.file_type;

  return {
    target_face_num,
    octree_resolution,
    steps,
    guidance_scale,
    remove_background,
    randomize_seed,
    seed,
    file_type,
  };
}
