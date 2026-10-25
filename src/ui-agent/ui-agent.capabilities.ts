import { BadRequestException } from '@nestjs/common';
import {
  APPROVED_PATCH_ROOTS,
  ComponentKindSchema,
  DEFAULT_DOCUMENT_LIMITS,
  DocumentKindSchema,
  InteractionSchema,
  PlatformProfileSchema,
  SpatialProfileSchema,
  type UiAgentCapabilities,
} from '@markaschmidt/ui-builder-contracts';
import type { UiVisibility } from './models/ui-agent.model.js';

export const UI_AGENT_INTENTS = [
  'chat',
  'analyze',
  'explain',
  'create',
  'edit',
  'restyle',
  'compose',
] as const;

export type UiAgentIntent = (typeof UI_AGENT_INTENTS)[number];

export interface UiModelPreset {
  id: string;
  label: string;
  tier: 'standard' | 'premium';
  capabilities: Array<
    'chat' | 'analysis' | 'document_generation' | 'document_edit' | 'vision'
  >;
  supportsText: boolean;
  supportsImages: boolean;
  supportsStructuredOutput: boolean;
  contextTokenLimit: number;
  outputTokenLimit: number;
  allowedDocumentKinds: string[];
  allowedIntents: UiAgentIntent[];
  allowedVisibilities: UiVisibility[];
  workerPolicy: {
    provider: 'openai' | 'openrouter';
    model: string;
  };
}

export function listUiModelPresets(): UiModelPreset[] {
  const presets: UiModelPreset[] = [
    {
      id: 'ui-standard',
      label: 'UI Standard',
      tier: 'standard',
      capabilities: [
        'chat',
        'analysis',
        'document_generation',
        'document_edit',
      ],
      supportsText: true,
      supportsImages: false,
      supportsStructuredOutput: true,
      contextTokenLimit: 48_000,
      outputTokenLimit: 12_000,
      allowedDocumentKinds: ['hud', 'menu', 'screen', 'overlay', 'spatial_ui'],
      allowedIntents: [...UI_AGENT_INTENTS],
      allowedVisibilities: ['shared', 'private'],
      workerPolicy: {
        provider: 'openai',
        model: process.env.VEKTRE_AI_OPENAI_MODEL ?? 'server-default',
      },
    },
    {
      id: 'ui-vision',
      label: 'UI Vision',
      tier: 'premium',
      capabilities: [
        'chat',
        'analysis',
        'document_generation',
        'document_edit',
        'vision',
      ],
      supportsText: true,
      supportsImages: true,
      supportsStructuredOutput: true,
      contextTokenLimit: 96_000,
      outputTokenLimit: 16_000,
      allowedDocumentKinds: ['hud', 'menu', 'screen', 'overlay', 'spatial_ui'],
      allowedIntents: [...UI_AGENT_INTENTS],
      allowedVisibilities: ['shared', 'private'],
      workerPolicy: {
        provider: 'openai',
        model: process.env.VEKTRE_AI_OPENAI_VISION_MODEL ?? 'server-default',
      },
    },
  ];
  if (process.env.VEKTRE_AI_ENABLE_OPENROUTER === 'true') {
    presets.push({
      ...presets[0],
      id: 'ui-openrouter',
      label: 'UI OpenRouter',
      tier: 'premium',
      supportsImages: true,
      capabilities: [...presets[1].capabilities],
      workerPolicy: {
        provider: 'openrouter',
        model: process.env.VEKTRE_AI_OPENROUTER_MODEL ?? 'server-default',
      },
    });
  }
  return presets;
}

export function resolveUiModelPreset(
  presetId: string | undefined,
  input: {
    visibility: UiVisibility;
    intent: UiAgentIntent;
    hasImages: boolean;
  },
): UiModelPreset {
  const preset = listUiModelPresets().find(
    (candidate) => candidate.id === (presetId ?? 'ui-standard'),
  );
  if (!preset) throw new BadRequestException('Unknown UI model preset');
  if (!preset.allowedVisibilities.includes(input.visibility)) {
    throw new BadRequestException(
      'Model preset is not allowed for this thread visibility',
    );
  }
  if (!preset.allowedIntents.includes(input.intent)) {
    throw new BadRequestException('Model preset does not support this intent');
  }
  if (input.hasImages && !preset.supportsImages) {
    throw new BadRequestException(
      'Model preset does not support image references',
    );
  }
  return preset;
}

export function uiAgentCapabilities(): UiAgentCapabilities {
  return {
    schemaVersion: 1,
    yjsSchemaVersion: 2,
    documentContract: 'VektreUIDocumentV2',
    migrations: { hudDocumentV1: true },
    documentKinds: [...DocumentKindSchema.options],
    componentKinds: [...ComponentKindSchema.options],
    interactionEvents: [...InteractionSchema.shape.event.options],
    interactionActions: [...InteractionSchema.shape.action.options],
    platformProfiles: [...PlatformProfileSchema.shape.platform.options],
    spatialProfiles: [...SpatialProfileSchema.shape.mode.options],
    patchRoots: [...APPROVED_PATCH_ROOTS],
    intents: [...UI_AGENT_INTENTS],
    limits: { ...DEFAULT_DOCUMENT_LIMITS },
    features: {
      chat: true,
      memory: true,
      retrieval: true,
      review: true,
      telemetry: true,
      multimodal: true,
      privateThreads: true,
      designMemoryPublish: true,
    },
    models: listUiModelPresets().map(({ workerPolicy, ...preset }) => {
      void workerPolicy;
      return preset;
    }),
  };
}

export function isMutatingUiIntent(intent: UiAgentIntent): boolean {
  return !['chat', 'analyze', 'explain'].includes(intent);
}
