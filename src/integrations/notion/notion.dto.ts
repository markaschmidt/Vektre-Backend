import { IsOptional, IsString, MaxLength } from 'class-validator';

export class NotionSearchDto {
  @IsString()
  @MaxLength(500)
  query!: string;

  @IsOptional()
  @IsString()
  filter?: 'page' | 'database';
}

export class NotionExportPageDto {
  @IsString()
  pageId!: string;
}

export class NotionOAuthExchangeDto {
  @IsString()
  code!: string;

  @IsOptional()
  @IsString()
  redirectUri?: string;
}
