import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CANVAS_ACTION_KINDS } from '../../collaboration-documents/models/canvas-graph.model.js';

export class CanvasActionInputAssetDto {
  @IsString()
  assetId!: string;

  @IsOptional()
  @IsString()
  portId?: string;
}

export class CanvasActionInputTextDto {
  @IsString()
  @MaxLength(8000)
  text!: string;

  @IsOptional()
  @IsString()
  portId?: string;

  @IsOptional()
  @IsString()
  contentHash?: string;
}

export class CanvasActionInputsDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CanvasActionInputTextDto)
  texts?: CanvasActionInputTextDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CanvasActionInputAssetDto)
  assets?: CanvasActionInputAssetDto[];
}

export class RunCanvasActionDto {
  @IsString()
  @MaxLength(128)
  workflowId!: string;

  @IsString()
  @MaxLength(128)
  nodeId!: string;

  /** Client-generated idempotency key for this action invocation. */
  @IsString()
  @MaxLength(128)
  runId!: string;

  @IsIn(CANVAS_ACTION_KINDS)
  actionKind!: (typeof CANVAS_ACTION_KINDS)[number];

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => CanvasActionInputsDto)
  inputs?: CanvasActionInputsDto;
}

export class RunCanvasActionBatchDto {
  @IsArray()
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => RunCanvasActionDto)
  actions!: RunCanvasActionDto[];
}
