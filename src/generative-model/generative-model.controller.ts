import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { GenerativeModelService } from './generative-model.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.model.js';
import { CreateGenRequestDto } from './dto/create-gen-request.dto.js';
import {
  Create3dRequestDto,
  CreateDocumentSuggestionDto,
  CreateConceptArtDto,
} from './dto/generative-requests.dto.js';

@Controller('generative-model')
export class GenerativeModelController {
  constructor(private readonly genService: GenerativeModelService) {}

  // ─── Legacy generic endpoint ──────────────────────────────────────────────

  @Post('requests')
  @HttpCode(HttpStatus.ACCEPTED)
  createRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGenRequestDto,
  ) {
    return this.genService.createRequest(user.id, dto);
  }

  @Get('requests/:requestId/wait')
  waitForStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
    @Query('timeoutMs') timeoutMs?: string,
  ) {
    return this.genService.waitForRequestStatus(
      requestId,
      user.id,
      timeoutMs ? Number(timeoutMs) : undefined,
    );
  }

  @Get('requests/:requestId')
  getStatus(
    @CurrentUser() _user: AuthenticatedUser,
    @Param('requestId') requestId: string,
  ) {
    return this.genService.getRequestStatus(requestId);
  }

  @Delete('requests/:requestId')
  @HttpCode(HttpStatus.ACCEPTED)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
  ) {
    return this.genService.cancelRequest(requestId, user.id);
  }

  // ─── Replicate 3D ─────────────────────────────────────────────────────────

  /**
   * POST /generative-model/3d
   * Enqueue a Hunyuan 3D generation. Returns 202 with requestId.
   * Poll status via GET /generative-model/requests/:requestId.
   */
  @Post('3d')
  @HttpCode(HttpStatus.ACCEPTED)
  create3d(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: Create3dRequestDto,
  ) {
    return this.genService.create3dRequest(user.id, dto);
  }

  // ─── OpenAI ───────────────────────────────────────────────────────────────

  /**
   * POST /generative-model/document-suggestions
   * Enqueue an OpenAI document suggestion. Returns 202 with requestId.
   */
  @Post('document-suggestions')
  @HttpCode(HttpStatus.ACCEPTED)
  createDocumentSuggestion(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDocumentSuggestionDto,
  ) {
    return this.genService.createDocumentSuggestion(user.id, dto);
  }

  /**
   * POST /generative-model/concept-art
   * Enqueue a DALL-E 3 concept art generation. Returns 202 with requestId.
   */
  @Post('concept-art')
  @HttpCode(HttpStatus.ACCEPTED)
  createConceptArt(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateConceptArtDto,
  ) {
    return this.genService.createConceptArt(user.id, dto);
  }

  // ─── Ollama ───────────────────────────────────────────────────────────────

  /**
   * GET /generative-model/ollama/models
   * List models available on the backend-local Ollama instance.
   * Returns 400 if Ollama is not configured.
   */
  @Get('ollama/models')
  listOllamaModels(@CurrentUser() _user: AuthenticatedUser) {
    return this.genService.listOllamaModels();
  }

  /**
   * POST /generative-model/ollama/document-suggestions
   * Enqueue an Ollama document suggestion (self-hosted/dev only).
   */
  @Post('ollama/document-suggestions')
  @HttpCode(HttpStatus.ACCEPTED)
  createOllamaDocumentSuggestion(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { documentText: string; modelId: string },
  ) {
    return this.genService.createOllamaDocumentSuggestion(user.id, dto);
  }
}
