import { IsIn } from 'class-validator';
import {
  USER_PLANS,
  type UserPlan,
} from '../../integrations/app-data.types.js';

const INTERVALS = ['month', 'year'] as const;

export class CreateCheckoutSessionDto {
  @IsIn(USER_PLANS)
  plan!: UserPlan;

  @IsIn(INTERVALS)
  interval!: (typeof INTERVALS)[number];
}
