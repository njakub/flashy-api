import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { GenerateService } from './generate.service';
import {
  LlmParseError,
  LlmProviderError,
  LlmRefusalError,
} from '../llm/provider';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { generateRequestSchema, type GenerateRequest } from './generate.schema';

@Controller('generate')
export class GenerateController {
  private readonly logger = new Logger(GenerateController.name);

  constructor(private readonly generator: GenerateService) {}

  /**
   * Turns source material (pasted text or a base64 PDF) into candidate
   * flashcards for the client's review step. Guarded like /grade — auth is
   * what keeps this off the open internet today; it's also the seam a future
   * per-user quota/rate-limit layer sits behind without reshaping the route.
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  async generate(
    @Body(new ZodValidationPipe(generateRequestSchema)) dto: GenerateRequest,
    @CurrentUser() user: AuthUser,
  ) {
    this.logger.debug(
      `Card generation requested by ${user.userId} (${dto.source.type}, target ${dto.targetCount})`,
    );
    try {
      return await this.generator.generate(user.userId, dto);
    } catch (err) {
      if (err instanceof LlmRefusalError) {
        throw new UnprocessableEntityException(
          'The model declined to process this material.',
        );
      }
      if (err instanceof LlmParseError) {
        throw new BadGatewayException('AI generation failed — try again.');
      }
      if (err instanceof LlmProviderError) {
        // Upstream 400 = the input itself is unusable (e.g. corrupt PDF,
        // over a provider's page/size limit) — the caller can fix that;
        // everything else is transient on the provider's side.
        if (err.status === 400) {
          throw new BadRequestException(
            `The AI service rejected this material: ${err.message}`,
          );
        }
        throw new ServiceUnavailableException(
          'AI service is busy — try again shortly.',
        );
      }
      throw err;
    }
  }
}
