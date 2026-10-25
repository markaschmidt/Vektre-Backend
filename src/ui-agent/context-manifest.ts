import { BadRequestException } from '@nestjs/common';
import {
  ContextManifestSchema,
  canonicalSha256,
  type ContextManifest,
} from '@markaschmidt/ui-builder-contracts';
import type { UiVisibility } from './models/ui-agent.model.js';

const SECTION_ORDER: Record<
  ContextManifest['sections'][number]['name'],
  number
> = {
  live_document: 0,
  explicit_references: 1,
  memory: 2,
  comments: 3,
  conversation: 4,
  human_delta: 5,
  artifacts: 6,
  retrieval: 7,
};

export function normalizeContextManifest(
  value: ContextManifest,
  runVisibility: UiVisibility,
): { manifest: ContextManifest; manifestHash: string } {
  const parsed = ContextManifestSchema.parse(value);
  const sectionNames = new Set<string>();

  const sections = parsed.sections
    .map((section) => {
      if (sectionNames.has(section.name)) {
        throw new BadRequestException(
          `Context section appears more than once: ${section.name}`,
        );
      }
      sectionNames.add(section.name);

      const sources = [...section.sources].sort(
        (left, right) =>
          left.rank - right.rank ||
          left.sourceKind.localeCompare(right.sourceKind) ||
          left.sourceId.localeCompare(right.sourceId) ||
          left.contentHash.localeCompare(right.contentHash),
      );
      const sourceKeys = new Set<string>();
      for (const source of sources) {
        const key = `${source.sourceKind}:${source.sourceId}:${source.contentHash}`;
        if (sourceKeys.has(key)) {
          throw new BadRequestException(
            `Duplicate context source in ${section.name}: ${key}`,
          );
        }
        sourceKeys.add(key);
        if (
          source.citation.sourceId !== source.sourceId ||
          source.citation.sourceKind !== source.sourceKind ||
          source.citation.contentHash !== source.contentHash ||
          source.citation.visibility !== source.visibility
        ) {
          throw new BadRequestException(
            `Context citation does not match source: ${key}`,
          );
        }
        if (runVisibility === 'shared' && source.visibility === 'private') {
          throw new BadRequestException(
            'A shared run context cannot contain private sources',
          );
        }
      }

      const estimatedTokens = sources.reduce(
        (total, source) => total + source.estimatedTokens,
        0,
      );
      if (estimatedTokens > section.tokenBudget) {
        throw new BadRequestException(
          `Context section exceeds token budget: ${section.name}`,
        );
      }
      return { ...section, sources, estimatedTokens };
    })
    .sort(
      (left, right) => SECTION_ORDER[left.name] - SECTION_ORDER[right.name],
    );

  const totalSectionBudget = sections.reduce(
    (total, section) => total + section.tokenBudget,
    0,
  );
  if (totalSectionBudget > parsed.totalTokenBudget) {
    throw new BadRequestException(
      'Context section budgets exceed the total token budget',
    );
  }

  const estimatedTokens = sections.reduce(
    (total, section) => total + section.estimatedTokens,
    0,
  );
  const manifest = ContextManifestSchema.parse({
    ...parsed,
    sections,
    estimatedTokens,
  });
  return { manifest, manifestHash: canonicalSha256(manifest) };
}
