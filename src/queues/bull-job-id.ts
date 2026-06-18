/**
 * BullMQ custom job IDs cannot contain ":" (Redis key constraint).
 * Join segments with "-" for stable, human-readable ids.
 */
export function bullJobId(...segments: string[]): string {
  return segments.join('-');
}
