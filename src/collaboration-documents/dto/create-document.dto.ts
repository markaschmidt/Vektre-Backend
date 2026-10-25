import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { COLLABORATION_DOCUMENT_TYPES } from '../models/collaboration-surface.model.js';
import type { CollaborationDocumentType } from '../../integrations/app-data.types.js';

export class CreateDocumentDto {
  @IsIn(COLLABORATION_DOCUMENT_TYPES as string[])
  documentType!: CollaborationDocumentType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
