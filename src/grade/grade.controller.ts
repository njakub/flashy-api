import { Body, Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { AnthropicGrader } from './grade.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { gradeRequestSchema, type GradeRequest } from './grade.schema';

@Controller('grade')
export class GradeController {
  private readonly logger = new Logger(GradeController.name);

  constructor(private readonly grader: AnthropicGrader) {}

  /**
   * Sends a typed test-mode answer to Claude for a correct/incorrect verdict.
   * Guarded like /sync — auth is what keeps this off the open internet today;
   * it's also the seam a future per-user quota/rate-limit layer sits behind
   * without reshaping the route.
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  grade(
    @Body(new ZodValidationPipe(gradeRequestSchema)) dto: GradeRequest,
    @CurrentUser() user: AuthUser,
  ) {
    this.logger.debug(`AI grade requested by ${user.userId}`);
    return this.grader.grade(dto);
  }
}
