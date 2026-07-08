import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UsageService } from './usage.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { usageRangeSchema, type UsageRange } from './usage.schema';

@Controller('usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  /** Cost/volume/latency/agreement breakdown for the profile usage dashboard. */
  @Get('summary')
  @UseGuards(JwtAuthGuard)
  summary(
    @Query('range', new ZodValidationPipe(usageRangeSchema)) range: UsageRange,
    @CurrentUser() user: AuthUser,
  ) {
    return this.usage.summary(user.userId, range);
  }

  /** Rule-based per-task model suggestions derived from the user's own last-30-day usage. */
  @Get('recommendations')
  @UseGuards(JwtAuthGuard)
  recommendations(@CurrentUser() user: AuthUser) {
    return this.usage.recommendations(user.userId);
  }
}
