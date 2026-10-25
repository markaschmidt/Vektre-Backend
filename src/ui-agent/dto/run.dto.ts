import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ReviewUiAgentRunDto {
  @IsIn(['approve', 'reject', 'request_changes'])
  decision!: 'approve' | 'reject' | 'request_changes';

  @IsOptional()
  @IsString()
  @MaxLength(256)
  alternativeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  notes?: string;
}

export class ReconcileUiAgentRunDto {
  @IsString()
  @MinLength(64)
  @MaxLength(64)
  appliedDocumentHash!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  appliedRevisionId?: string;
}
