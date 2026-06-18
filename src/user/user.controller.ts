import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Param,
} from '@nestjs/common';
import { UserService } from './user.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.model.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';

@Controller('users/me')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /** No profile row → 404. Client routes to /onboarding. */
  @Get('profile')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.userService.getProfile(user.id);
  }

  /** Creates profile on first PATCH (onboarding) or updates an existing one. */
  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.userService.updateProfile(user.id, dto);
  }

  @Post('provider-connections/:provider/sync')
  @HttpCode(HttpStatus.ACCEPTED)
  syncProvider(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider') provider: string,
  ) {
    return this.userService.syncProviderDocuments(user.id, provider);
  }
}
