import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateUiThreadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  title!: string;

  @IsIn(['shared', 'private'])
  visibility!: 'shared' | 'private';
}

export class UpdateUiThreadDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  title?: string;

  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';
}

export class ListUiThreadsDto {
  @IsOptional()
  @IsIn(['all', 'shared', 'private'])
  visibility?: 'all' | 'shared' | 'private';

  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';

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
