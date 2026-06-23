import { IsOptional, IsString, MaxLength } from 'class-validator';

export class JoinByCodeDto {
  @IsString()
  @MaxLength(64)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;
}
