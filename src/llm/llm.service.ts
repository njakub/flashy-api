import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LLM_PROVIDERS } from './llm.constants';
import { computeCostMicroUsd, type LlmTaskId, type ModelDef } from './models';
import {
  LlmParseError,
  LlmProviderError,
  LlmRefusalError,
  ZERO_USAGE,
  type LlmProvider,
  type LlmStructuredRequest,
  type LlmStructuredResult,
} from './provider';
import { LlmUsageService } from './usage.service';

export interface RunOpts<T> {
  ownerId: string;
  task: LlmTaskId;
  model: ModelDef;
  request: LlmStructuredRequest<T>;
  /** Grading-only — the embedding pre-filter's verdict when the cascade escalated to the LLM. */
  localSignal?: { outcome: string; similarity?: number };
  /** Generation-only — whether the source material was a PDF. */
  isPdfSource?: boolean;
}

export interface RunResult<T> extends LlmStructuredResult<T> {
  /** The pre-generated LlmUsage row id — returned so /grade can hand it back for POST /grade/feedback. */
  usageId: string;
}

function classifyError(
  err: unknown,
): 'refusal' | 'parse' | 'provider' | 'unknown' {
  if (err instanceof LlmRefusalError) return 'refusal';
  if (err instanceof LlmParseError) return 'parse';
  if (err instanceof LlmProviderError) return 'provider';
  return 'unknown';
}

/**
 * The single entry point every LLM-calling feature (grading, generation)
 * goes through: dispatches to the right provider, times the call, and
 * records usage — on success AND failure — without ever letting tracking
 * add latency or a new failure mode to the calling feature.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly providersByType: Map<string, LlmProvider>;

  constructor(
    @Inject(LLM_PROVIDERS) providers: LlmProvider[],
    private readonly usage: LlmUsageService,
  ) {
    this.providersByType = new Map(providers.map((p) => [p.id, p]));
  }

  async run<T>(opts: RunOpts<T>): Promise<RunResult<T>> {
    const provider = this.providersByType.get(opts.model.provider);
    if (!provider) {
      throw new LlmProviderError(
        `No LLM provider registered for "${opts.model.provider}" (model "${opts.model.id}")`,
      );
    }

    const usageId = randomUUID();
    const started = Date.now();

    try {
      const result = await provider.completeStructured(
        opts.model,
        opts.request,
      );
      const latencyMs = Date.now() - started;
      void this.usage
        .record({
          id: usageId,
          ownerId: opts.ownerId,
          task: opts.task,
          provider: opts.model.provider,
          model: opts.model.id,
          usage: result.usage,
          costMicroUsd: computeCostMicroUsd(opts.model, result.usage),
          latencyMs,
          success: true,
          llmOutcome: extractOutcome(result.output),
          localOutcome: opts.localSignal?.outcome,
          localSimilarity: opts.localSignal?.similarity,
          isPdfSource: opts.isPdfSource,
        })
        .catch((err: Error) => this.logger.warn(err.message));
      return { ...result, usageId };
    } catch (err) {
      const latencyMs = Date.now() - started;
      const usageFromErr =
        err instanceof LlmProviderError ? err.usage : undefined;
      void this.usage
        .record({
          id: usageId,
          ownerId: opts.ownerId,
          task: opts.task,
          provider: opts.model.provider,
          model: opts.model.id,
          usage: usageFromErr ?? ZERO_USAGE,
          costMicroUsd: usageFromErr
            ? computeCostMicroUsd(opts.model, usageFromErr)
            : 0,
          latencyMs,
          success: false,
          errorKind: classifyError(err),
          localOutcome: opts.localSignal?.outcome,
          localSimilarity: opts.localSignal?.similarity,
          isPdfSource: opts.isPdfSource,
        })
        .catch((e: Error) => this.logger.warn(e.message));
      throw err;
    }
  }
}

/** Grading responses carry `outcome`; generation responses don't — undefined is fine, the column is nullable. */
function extractOutcome(output: unknown): string | undefined {
  if (
    output !== null &&
    typeof output === 'object' &&
    'outcome' in output &&
    typeof output.outcome === 'string'
  ) {
    return (output as { outcome: string }).outcome;
  }
  return undefined;
}
