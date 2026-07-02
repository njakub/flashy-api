import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SyncService } from './sync.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { syncRequestSchema, type SyncRequest } from './sync.schema';

@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  /**
   * One push+pull round trip. ownerId always comes from the verified JWT —
   * never from the request body — so a client can't write into another
   * user's data even if it lies about ownerId in a pushed row.
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  sync(
    @Body(new ZodValidationPipe(syncRequestSchema)) dto: SyncRequest,
    @CurrentUser() user: AuthUser,
  ) {
    return this.syncService.sync(user.userId, dto);
  }
}
