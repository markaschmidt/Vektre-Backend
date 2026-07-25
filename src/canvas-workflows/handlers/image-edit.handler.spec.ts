import { BadRequestException } from '@nestjs/common';
import { ImageEditActionHandler } from './image-edit.handler.js';
import type { CanvasActionRunContext } from '../canvas-action.interface.js';
import type { GenerativeModelService } from '../../generative-model/generative-model.service.js';
import type { CanvasAssetOutputService } from '../canvas-asset-output.service.js';
import type { AppDataService } from '../../integrations/app-data.service.js';

function makeCtx(
  overrides: Partial<CanvasActionRunContext> = {},
): CanvasActionRunContext {
  return {
    projectId: 'proj-1',
    documentId: 'doc-canvas',
    userId: 'user-1',
    workflowId: 'wf-1',
    nodeId: 'node-edit-1',
    runId: 'run-edit-1',
    actionKind: 'image_edit',
    activityId: 'act-1',
    requestId: 'req-1',
    config: {},
    inputs: { texts: [], assets: [] },
    ...overrides,
  };
}

describe('ImageEditActionHandler', () => {
  const generative = {
    enqueueConceptArt: jest.fn().mockResolvedValue(undefined),
  };
  const outputs = {
    createSignedAssetUrl: jest
      .fn()
      .mockResolvedValue({ signedUrl: 'https://signed.example/img.png' }),
  };
  const appData = {
    getProjectAsset: jest.fn(),
  };

  let handler: ImageEditActionHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    appData.getProjectAsset.mockResolvedValue({
      assetId: 'img-1',
      projectId: 'proj-1',
      objectPath: 'projects/proj-1/assets/img-1.png',
    });
    handler = new ImageEditActionHandler(
      generative as unknown as GenerativeModelService,
      outputs as unknown as CanvasAssetOutputService,
      appData as unknown as AppDataService,
    );
  });

  it('rejects when prompt is missing', async () => {
    await expect(
      handler.validate(
        makeCtx({
          inputs: {
            texts: [],
            assets: [{ portId: 'image', assetId: 'img-1' }],
          },
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when no source images are provided', async () => {
    await expect(
      handler.validate(
        makeCtx({
          config: { prompt: 'Make the sky purple' },
          inputs: { texts: [], assets: [] },
        }),
      ),
    ).rejects.toThrow(/at least one source image/);
  });

  it('enqueues multimodal edit via shared enqueueConceptArt', async () => {
    const ctx = makeCtx({
      config: { prompt: 'Same character, turn to the left', style: 'painterly' },
      inputs: {
        texts: [],
        assets: [
          { portId: 'image', assetId: 'img-1' },
          { portId: 'image', assetId: 'img-2' },
        ],
      },
    });
    appData.getProjectAsset.mockImplementation(async (id: string) => ({
      assetId: id,
      projectId: 'proj-1',
      objectPath: `projects/proj-1/assets/${id}.png`,
    }));

    await handler.validate(ctx);
    await handler.enqueue(ctx);

    expect(outputs.createSignedAssetUrl).toHaveBeenCalledTimes(2);
    expect(generative.enqueueConceptArt).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Same character'),
        style: 'painterly',
        referenceUrls: [
          'https://signed.example/img.png',
          'https://signed.example/img.png',
        ],
        referenceAssetIds: ['img-1', 'img-2'],
        preferredAssetId: 'edit-run-edit-1',
        projectId: 'proj-1',
        activityId: 'act-1',
      }),
    );
  });
});
