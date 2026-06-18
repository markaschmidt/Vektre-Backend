import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { UserPlan, UserType, UserUseCase } from '../../integrations/app-data.types.js';

const USER_PLANS = [
  'indie_free',
  'indie_pro',
  'corp_starter',
  'corp_team',
  'corp_enterprise',
] as const;

export class ProfilePreferencesDto {
  @IsOptional()
  @IsBoolean()
  onboardingCompleted?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[A-Za-z\s]+$/, { message: 'firstName must contain only letters and spaces' })
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[A-Za-z\s]+$/, { message: 'lastName must contain only letters and spaces' })
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[A-Za-z\s]+$/, { message: 'role must contain only letters and spaces' })
  role?: string;

  /** Legacy — not collected during onboarding. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  jobTitle?: string;

  @IsOptional()
  @IsEnum(['personal', 'indie', 'enterprise'])
  userType?: UserType;

  @IsOptional()
  @IsEnum(['game_development', 'animation', 'cinema_film'])
  useCase?: UserUseCase;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[A-Za-z\s]*$/, { message: 'company must contain only letters and spaces' })
  company?: string;

  @IsOptional()
  @IsEnum(USER_PLANS)
  selectedPlan?: UserPlan;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  @IsOptional()
  @IsUrl()
  avatarUrl?: string;

  @IsOptional()
  @IsEnum(USER_PLANS)
  plan?: UserPlan;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProfilePreferencesDto)
  @IsObject()
  preferences?: ProfilePreferencesDto;
}
