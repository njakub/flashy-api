import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { z } from 'zod';
import type { ModelDef } from '../models';
import {
  LlmProviderError,
  ZERO_USAGE,
  type LlmProvider,
  type LlmStructuredRequest,
  type LlmStructuredResult,
} from '../provider';
import { parseJsonWithRetry } from '../structured';

/**
 * DeepSeek's chat/completions response is OpenAI-wire-compatible plus two
 * extension fields the base `openai` SDK types don't know about.
 * https://api-docs.deepseek.com/quick_start/pricing
 */
interface DeepSeekUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

@Injectable()
export class DeepSeekProvider implements LlmProvider {
  readonly id = 'deepseek' as const;
  private readonly logger = new Logger(DeepSeekProvider.name);
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = process.env['DEEPSEEK_API_KEY'];
      if (!apiKey) {
        throw new LlmProviderError('DEEPSEEK_API_KEY is not configured', 503);
      }
      this.client = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com' });
    }
    return this.client;
  }

  async completeStructured<T>(
    model: ModelDef,
    req: LlmStructuredRequest<T>,
  ): Promise<LlmStructuredResult<T>> {
    if (req.user.pdfBase64) {
      // Unreachable in practice — GenerateService falls back to a
      // PDF-capable model before dispatching here (registry: supportsPdf:
      // false). This is a safety net, not a user-facing path.
      throw new LlmProviderError(`${model.id} does not support PDF input`, 400);
    }

    const client = this.getClient();
    const schemaJson = JSON.stringify(z.toJSONSchema(req.schema));
    const systemWithSchema = `${req.system}\n\nRespond with ONLY a single JSON object matching this JSON Schema exactly, no prose or markdown fences:\n${schemaJson}`;

    // Accumulated across the retry — both calls are billed by DeepSeek.
    const usage = { ...ZERO_USAGE };

    const callOnce = async (
      messages: OpenAI.Chat.ChatCompletionMessageParam[],
    ): Promise<string> => {
      let response;
      try {
        response = await client.chat.completions.create({
          model: model.providerModelId,
          max_tokens: req.maxOutputTokens,
          response_format: { type: 'json_object' },
          messages,
        });
      } catch (err) {
        if (err instanceof OpenAI.APIError) {
          this.logger.warn(`DeepSeek error ${err.status}: ${err.message}`);
          throw new LlmProviderError(
            err.message,
            err.status as number | undefined,
            usage,
          );
        }
        throw err;
      }

      const raw = response.usage as DeepSeekUsage | undefined;
      const hit = raw?.prompt_cache_hit_tokens ?? 0;
      const miss =
        raw?.prompt_cache_miss_tokens ?? (raw?.prompt_tokens ?? 0) - hit;
      usage.inputTokens += Math.max(miss, 0);
      usage.cachedInputTokens += hit;
      usage.outputTokens += response.usage?.completion_tokens ?? 0;

      const text = response.choices[0]?.message?.content;
      if (!text) {
        throw new LlmProviderError(
          'DeepSeek returned an empty response',
          undefined,
          usage,
        );
      }
      return text;
    };

    const baseMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemWithSchema },
      { role: 'user', content: req.user.text },
    ];

    const first = await callOnce(baseMessages);
    const output = await parseJsonWithRetry(req.schema, first, (feedback) =>
      callOnce([
        ...baseMessages,
        { role: 'assistant', content: first },
        { role: 'user', content: feedback },
      ]),
    );

    return { output, usage };
  }
}
