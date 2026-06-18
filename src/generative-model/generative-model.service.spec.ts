import { GenerativeModelService } from './generative-model.service.js';
import { AppDataService } from '../integrations/app-data.service.js';
import { OllamaProviderAdapter } from './providers/ollama.provider.js';
import { BadRequestException } from '@nestjs/common';

const mockQueue = {
  add: jest.fn().mockResolvedValue({ id: 'job-1' }),
};

const mockAppData = {
  createRequestStatus: jest.fn().mockResolvedValue(undefined),
  createGenRequest: jest.fn().mockResolvedValue(undefined),
  getRequestStatus: jest.fn(),
};

const mockOllama = {
  isEnabled: false,
  listModels: jest.fn(),
};

describe('GenerativeModelService', () => {
  let service: GenerativeModelService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GenerativeModelService(
      mockQueue as never,
      mockAppData as unknown as AppDataService,
      mockOllama as unknown as OllamaProviderAdapter,
    );
  });

  describe('create3dRequest', () => {
    it('throws if neither imageUrl nor prompt is provided', async () => {
      await expect(service.create3dRequest('user-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('enqueues a job and returns requestId when imageUrl is provided', async () => {
      const result = await service.create3dRequest('user-1', {
        imageUrl: 'https://example.com/image.png',
      });
      expect(result.status).toBe('queued');
      expect(result.requestId).toBeDefined();
      expect(mockQueue.add).toHaveBeenCalledWith(
        'replicate-generate-3d',
        expect.objectContaining({ userId: 'user-1', imageUrl: 'https://example.com/image.png' }),
        expect.objectContaining({ jobId: expect.stringContaining('replicate-3d-user-1') }),
      );
    });

    it('enqueues a job when prompt is provided', async () => {
      const result = await service.create3dRequest('user-2', {
        prompt: 'a red sports car',
      });
      expect(result.status).toBe('queued');
      expect(mockQueue.add).toHaveBeenCalledWith(
        'replicate-generate-3d',
        expect.objectContaining({ prompt: 'a red sports car' }),
        expect.anything(),
      );
    });

    it('throws if both imageUrl and prompt are provided', async () => {
      await expect(
        service.create3dRequest('user-1', {
          imageUrl: 'https://example.com/image.png',
          prompt: 'a sword',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getRequestStatus', () => {
    it('returns Tauri-compatible fields for completed replicate-3d jobs', async () => {
      mockAppData.getRequestStatus.mockResolvedValue({
        requestId: 'req-1',
        userId: 'user-1',
        type: 'replicate-3d',
        status: 'completed',
        outputRef: 'https://delivery.replicate.com/model.glb',
        resultJson: {
          predictionId: 'pred-1',
          modelUrl: 'https://delivery.replicate.com/model.glb',
          previewUrl: 'https://delivery.replicate.com/preview.png',
        },
        createdAt: new Date('2026-06-12T00:00:00Z'),
        updatedAt: new Date('2026-06-12T00:02:00Z'),
      });

      const result = await service.getRequestStatus('req-1');

      expect(result?.jobStatus).toBe('succeeded');
      expect(result?.modelUrl).toBe('https://delivery.replicate.com/model.glb');
      expect(result?.previewUrl).toBe('https://delivery.replicate.com/preview.png');
      expect(result?.predictionId).toBe('pred-1');
    });
  });

  describe('createDocumentSuggestion', () => {
    it('enqueues an openai-document-suggestion job', async () => {
      const result = await service.createDocumentSuggestion('user-1', {
        documentText: 'This is a test document',
      });
      expect(result.status).toBe('queued');
      expect(mockQueue.add).toHaveBeenCalledWith(
        'openai-document-suggestion',
        expect.objectContaining({ documentText: 'This is a test document' }),
        expect.anything(),
      );
    });
  });

  describe('createConceptArt', () => {
    it('enqueues an openai-concept-art job', async () => {
      const result = await service.createConceptArt('user-1', {
        prompt: 'futuristic city at night',
      });
      expect(result.status).toBe('queued');
      expect(mockQueue.add).toHaveBeenCalledWith(
        'openai-concept-art',
        expect.objectContaining({ prompt: 'futuristic city at night' }),
        expect.anything(),
      );
    });
  });

  describe('createOllamaDocumentSuggestion', () => {
    it('throws BadRequestException when Ollama is not enabled', async () => {
      await expect(
        service.createOllamaDocumentSuggestion('user-1', {
          documentText: 'test',
          modelId: 'llama3',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('enqueues when Ollama is enabled', async () => {
      mockOllama.isEnabled = true;
      const result = await service.createOllamaDocumentSuggestion('user-1', {
        documentText: 'test doc',
        modelId: 'llama3',
      });
      expect(result.status).toBe('queued');
      expect(mockQueue.add).toHaveBeenCalledWith(
        'ollama-document-suggestion',
        expect.objectContaining({ modelId: 'llama3' }),
        expect.anything(),
      );
      mockOllama.isEnabled = false;
    });
  });

  describe('listOllamaModels', () => {
    it('throws when Ollama is disabled', async () => {
      await expect(service.listOllamaModels()).rejects.toThrow(BadRequestException);
    });
  });
});
