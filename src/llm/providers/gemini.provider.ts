import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI, ApiError, FinishReason, type Part } from '@google/genai';
import { z } from 'zod';
import type { ModelDef } from '../models';
import {
  LlmProviderError,
  LlmRefusalError,
  ZERO_USAGE,
  type LlmProvider,
  type LlmStructuredRequest,
  type LlmStructuredResult,
} from '../provider';
import { parseJsonWithRetry } from '../structured';

/**
 * z.toJSONSchema's output is a standard JSON Schema; Gemini's
 * responseJsonSchema supports a documented subset (no `$schema`) — strip the
 * one key it doesn't recognize rather than hand-rolling a full converter.
 */
function toGeminiJsonSchema(schema: z.ZodType): unknown {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json['$schema'];
  return json;
}

@Injectable()
export class GeminiProvider implements LlmProvider {
  readonly id = 'google' as const;
  private readonly logger = new Logger(GeminiProvider.name);
  private client: GoogleGenAI | null = null;

  private getClient(): GoogleGenAI {
    if (!this.client) {
      const apiKey = process.env['GEMINI_API_KEY'];
      if (!apiKey) {
        throw new LlmProviderError('GEMINI_API_KEY is not configured', 503);
      }
      this.client = new GoogleGenAI({ apiKey });
    }
    return this.client;
  }

  async completeStructured<T>(
    model: ModelDef,
    req: LlmStructuredRequest<T>,
  ): Promise<LlmStructuredResult<T>> {
    const client = this.getClient();
    const basePart: Part = { text: req.user.text };
    const parts: Part[] = req.user.pdfBase64
      ? [
          {
            inlineData: {
              data: req.user.pdfBase64,
              mimeType: 'application/pdf',
            },
          },
          basePart,
        ]
      : [basePart];

    // Accumulated across the retry — both calls are billed by Gemini.
    const usage = { ...ZERO_USAGE };

    const callOnce = async (turnParts: Part[]): Promise<string> => {
      let response;
      try {
        response = await client.models.generateContent({
          model: model.providerModelId,
          contents: [{ role: 'user', parts: turnParts }],
          config: {
            systemInstruction: req.system,
            maxOutputTokens: req.maxOutputTokens,
            responseMimeType: 'application/json',
            responseJsonSchema: toGeminiJsonSchema(req.schema),
            thinkingConfig:
              req.reasoning === 'none' ? { thinkingBudget: 0 } : undefined,
          },
        });
      } catch (err) {
        if (err instanceof ApiError) {
          this.logger.warn(`Gemini error ${err.status}: ${err.message}`);
          throw new LlmProviderError(err.message, err.status, usage);
        }
        throw err;
      }

      const m = response.usageMetadata;
      const cached = m?.cachedContentTokenCount ?? 0;
      usage.inputTokens += (m?.promptTokenCount ?? 0) - cached;
      usage.cachedInputTokens += cached;
      usage.outputTokens +=
        (m?.candidatesTokenCount ?? 0) + (m?.thoughtsTokenCount ?? 0);

      const finishReason = response.candidates?.[0]?.finishReason;
      const text = response.text;
      if (!text) {
        if (
          finishReason === FinishReason.SAFETY ||
          finishReason === FinishReason.PROHIBITED_CONTENT
        ) {
          throw new LlmRefusalError();
        }
        throw new LlmProviderError(
          `Gemini returned no text (finishReason=${finishReason ?? 'unknown'})`,
          undefined,
          usage,
        );
      }
      return text;
    };

    const first = await callOnce(parts);
    const output = await parseJsonWithRetry(req.schema, first, (feedback) =>
      callOnce([...parts, { text: feedback }]),
    );

    return { output, usage };
  }
}
