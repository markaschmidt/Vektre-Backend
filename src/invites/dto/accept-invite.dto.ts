import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AcceptInviteDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;
}
