import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { LlmTaskId } from './models';
import type { LlmTokenUsage } from './models';

export interface RecordUsageInput {
  id: string;
  ownerId: string;
  task: LlmTaskId;
  provider: string;
  model: string;
  usage: LlmTokenUsage;
  costMicroUsd: number;
  latencyMs: number;
  success: boolean;
  errorKind?: 'refusal' | 'parse' | 'provider' | 'unknown';
  /** Grading-only quality signals — ignored for generation rows. */
  llmOutcome?: string;
  localOutcome?: string;
  localSimilarity?: number;
  /** Generation-only — whether the source material was a PDF. */
  isPdfSource?: boolean;
}

const toDbTask = (task: LlmTaskId): 'GRADING' | 'GENERATION' =>
  task === 'grading' ? 'GRADING' : 'GENERATION';

/**
 * Thin writer around the LlmUsage table. Callers (LlmService) fire-and-forget
 * this so tracking never adds latency or a new failure mode to grading/
 * generation — see LlmService.run's `void this.usage.record(...).catch(...)`.
 */
@Injectable()
export class LlmUsageService {
  private readonly logger = new Logger(LlmUsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordUsageInput): Promise<void> {
    try {
      await this.prisma.llmUsage.create({
        data: {
          id: input.id,
          ownerId: input.ownerId,
          task: toDbTask(input.task),
          provider: input.provider,
          model: input.model,
          inputTokens: input.usage.inputTokens,
          cachedInputTokens: input.usage.cachedInputTokens,
          outputTokens: input.usage.outputTokens,
          costMicroUsd: input.costMicroUsd,
          latencyMs: input.latencyMs,
          success: input.success,
          errorKind: input.errorKind ?? null,
          llmOutcome: input.llmOutcome ?? null,
          localOutcome: input.localOutcome ?? null,
          localSimilarity: input.localSimilarity ?? null,
          isPdfSource: input.isPdfSource ?? null,
        },
      });
    } catch (err) {
      // Usage tracking must never break the calling feature — log and swallow.
      this.logger.warn(`Failed to record LLM usage: ${(err as Error).message}`);
    }
  }
}
