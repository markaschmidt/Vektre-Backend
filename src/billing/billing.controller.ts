import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.model.js';
import { BillingService } from './billing.service.js';
import { PromoCodesService } from './promo-codes.service.js';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto.js';
import { RedeemPromoDto } from './dto/redeem-promo.dto.js';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly promos: PromoCodesService,
  ) {}

  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.billing.getSummary(user.id);
  }

  @Get('usage')
  getUsage(@CurrentUser() user: AuthenticatedUser) {
    return this.billing.getUsage(user.id);
  }

  @Post('checkout-session')
  @HttpCode(HttpStatus.OK)
  createCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCheckoutSessionDto,
  ) {
    return this.billing.createCheckoutSession(
      user.id,
      dto.plan,
      dto.interval,
      user.email,
    );
  }

  @Post('portal-session')
  @HttpCode(HttpStatus.OK)
  createPortal(@CurrentUser() user: AuthenticatedUser) {
    return this.billing.createPortalSession(user.id);
  }

  @Post('promo/redeem')
  @HttpCode(HttpStatus.OK)
  redeemPromo(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RedeemPromoDto,
  ) {
    return this.promos.redeem(user.id, dto.code);
  }
}
