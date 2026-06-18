import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class Create3dRequestDto {
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  prompt?: string;
}

export class CreateDocumentSuggestionDto {
  @IsString()
  @MaxLength(8000)
  documentText!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  context?: string;
}

export class CreateConceptArtDto {
  @IsString()
  @MaxLength(2000)
  prompt!: string;

  @IsOptional()
  @IsString()
  style?: string;
}
