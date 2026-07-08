import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ModelDef } from '../models';
import {
  LlmProviderError,
  LlmRefusalError,
  LlmParseError,
  type LlmProvider,
  type LlmStructuredRequest,
  type LlmStructuredResult,
} from '../provider';

@Injectable()
export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic' as const;
  private readonly logger = new Logger(AnthropicProvider.name);
  // No explicit apiKey — let the SDK resolve credentials itself (env var,
  // then an `ant auth login` profile). Passing an empty-string env value
  // here would shadow a working profile instead of falling through to it.
  private readonly client = new Anthropic();

  async completeStructured<T>(
    model: ModelDef,
    req: LlmStructuredRequest<T>,
  ): Promise<LlmStructuredResult<T>> {
    const content: Anthropic.ContentBlockParam[] = req.user.pdfBase64
      ? [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: req.user.pdfBase64,
            },
          },
          { type: 'text', text: req.user.text },
        ]
      : [{ type: 'text', text: req.user.text }];

    let response;
    try {
      response = await this.client.messages.parse({
        model: model.providerModelId,
        max_tokens: req.maxOutputTokens,
        ...(req.reasoning === 'default'
          ? { thinking: { type: 'adaptive' as const } }
          : {}),
        system: req.system,
        messages: [{ role: 'user', content }],
        output_config: { format: zodOutputFormat(req.schema) },
      });
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        this.logger.warn(`Anthropic error ${err.status}: ${err.message}`);
        throw new LlmProviderError(
          err.message,
          err.status as number | undefined,
        );
      }
      throw err;
    }

    const usage = {
      inputTokens: response.usage.input_tokens,
      cachedInputTokens: response.usage.cache_read_input_tokens ?? 0,
      outputTokens: response.usage.output_tokens,
    };

    if (response.stop_reason === 'refusal') {
      this.logger.warn('Anthropic call refused');
      throw new LlmRefusalError();
    }
    if (!response.parsed_output) {
      this.logger.warn(
        `Anthropic call did not resolve (stop_reason=${response.stop_reason})`,
      );
      throw new LlmParseError();
    }

    return { output: response.parsed_output, usage };
  }
}
