import { z } from 'zod';

export const SCHEMA_VERSION = 2 as const;

export const SemanticIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[a-z][a-z0-9_]*(?:[.-][a-z0-9_]+)*$/,
    'Must be a stable lowercase semantic identifier',
  );

export const OpaqueIdSchema = z.string().min(1).max(256);
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const IsoDateTimeSchema = z.string().datetime({ offset: true });
export const JsonValueSchema = z.json();
export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

export const VisibilitySchema = z.enum(['shared', 'private']);
export const SourceVisibilitySchema = z.enum(['shared', 'private', 'system']);

export const DocumentKindSchema = z.enum([
  'hud',
  'menu',
  'screen',
  'overlay',
  'spatial_ui',
]);

export type SemanticId = z.infer<typeof SemanticIdSchema>;
export type JsonValue = z.infer<typeof JsonValueSchema>;
export type DocumentKind = z.infer<typeof DocumentKindSchema>;
