import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AcceptShareLinkDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;
}
