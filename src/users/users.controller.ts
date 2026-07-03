import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { updateProfileSchema, type UpdateProfileDto } from './users.schema';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Returns the authenticated user's profile, including synced settings. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: AuthUser) {
    return this.usersService.getProfile(user.userId);
  }

  /**
   * Updates synced profile settings. userId always comes from the verified
   * JWT — never the request body — same rule as SyncController.
   */
  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateMe(
    @Body(new ZodValidationPipe(updateProfileSchema)) dto: UpdateProfileDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.usersService.updateGradingDefault(
      user.userId,
      dto.gradingDefault,
    );
  }
}
