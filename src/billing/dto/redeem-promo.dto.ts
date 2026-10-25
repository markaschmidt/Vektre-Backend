import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RedeemPromoDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'code must be alphanumeric (plus _ or -)',
  })
  code!: string;
}
