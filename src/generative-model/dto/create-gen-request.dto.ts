import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateGenRequestDto {
  @IsString()
  @MaxLength(8000)
  prompt!: string;

  @IsString()
  modelProvider!: string;

  @IsString()
  modelId!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  inputRefs?: string[];
}
