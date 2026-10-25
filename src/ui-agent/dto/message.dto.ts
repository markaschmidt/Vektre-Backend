import { Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  UI_AGENT_INTENTS,
  type UiAgentIntent,
} from '../ui-agent.capabilities.js';

export class AppendUiMessageDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(128)
  @Allow()
  parts!: unknown[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(256)
  @Allow()
  citations?: unknown[];

  @IsOptional()
  @IsBoolean()
  execute?: boolean;

  @ValidateIf((value: AppendUiMessageDto) => value.execute === true)
  @IsIn(UI_AGENT_INTENTS)
  intent?: UiAgentIntent;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  modelPresetId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(128)
  @IsString({ each: true })
  @MaxLength(256, { each: true })
  selectionHints?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(256)
  idempotencyKey?: string;
}

export class ListUiMessagesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  cursor?: string;
}
