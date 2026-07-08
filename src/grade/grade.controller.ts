import {
  BadGatewayException,
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { GradeService } from './grade.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  LlmParseError,
  LlmProviderError,
  LlmRefusalError,
} from '../llm/provider';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import {
  gradeRequestSchema,
  gradeFeedbackRequestSchema,
  type GradeRequest,
  type GradeFeedbackRequest,
} from './grade.schema';

@Controller('grade')
export class GradeController {
  private readonly logger = new Logger(GradeController.name);

  constructor(
    private readonly grader: GradeService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Sends a typed test-mode answer to the user's configured grading model
   * for a correct/incorrect verdict. Guarded like /sync — auth is what keeps
   * this off the open internet today; it's also the seam a future per-user
   * quota/rate-limit layer sits behind without reshaping the route.
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  async grade(
    @Body(new ZodValidationPipe(gradeRequestSchema)) dto: GradeRequest,
    @CurrentUser() user: AuthUser,
  ) {
    this.logger.debug(`AI grade requested by ${user.userId}`);
    try {
      return await this.grader.grade(user.userId, dto);
    } catch (err) {
      if (err instanceof LlmRefusalError) {
        throw new UnprocessableEntityException(
          'The model declined to grade this answer.',
        );
      }
      if (err instanceof LlmParseError) {
        throw new BadGatewayException('AI grading failed — try again.');
      }
      if (err instanceof LlmProviderError) {
        throw new ServiceUnavailableException(
          'AI service is busy — try again shortly.',
        );
      }
      throw err;
    }
  }

  /**
   * Records the user's own final verdict against a prior AI grade — the
   * primary quality/agreement signal for the usage dashboard. Best-effort
   * from the client's point of view; ownerId in the update's where-clause is
   * the tenancy check (a usageId belonging to another user silently no-ops).
   */
  @Post('feedback')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async feedback(
    @Body(new ZodValidationPipe(gradeFeedbackRequestSchema))
    dto: GradeFeedbackRequest,
    @CurrentUser() user: AuthUser,
  ) {
    await this.prisma.llmUsage.updateMany({
      where: { id: dto.usageId, ownerId: user.userId, task: 'GRADING' },
      data: { userOverride: dto.userVerdict },
    });
  }
}
