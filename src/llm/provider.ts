import { z } from 'zod';
import type { ModelDef, LlmTokenUsage, ProviderId } from './models';

/**
 * A single structured-output LLM request, shaped to cover both grading
 * (short text-only prompts) and generation (longer prompts, optional PDF,
 * optional reasoning) behind one interface. `schema` is the single contract
 * every provider adapter must satisfy — Anthropic enforces it natively,
 * Gemini/DeepSeek enforce it via JSON mode + a Zod parse (see structured.ts).
 */
export interface LlmStructuredRequest<T> {
  system: string;
  user: { text: string; pdfBase64?: string };
  schema: z.ZodType<T>;
  /** Short slug used by providers that embed the schema in-prompt (Gemini/DeepSeek). */
  schemaName: string;
  maxOutputTokens: number;
  /** 'default' enables provider-native reasoning (Anthropic adaptive thinking); grading always uses 'none'. */
  reasoning: 'none' | 'default';
}

export interface LlmStructuredResult<T> {
  output: T;
  usage: LlmTokenUsage;
}

export interface LlmProvider {
  readonly id: ProviderId;
  completeStructured<T>(
    model: ModelDef,
    req: LlmStructuredRequest<T>,
  ): Promise<LlmStructuredResult<T>>;
}

/** The model declined to answer (safety/policy). Callers map this to 422. */
export class LlmRefusalError extends Error {
  constructor(message = 'The model declined to produce a verdict') {
    super(message);
    this.name = 'LlmRefusalError';
  }
}

/** The model never produced output matching the schema, even after a retry. Callers map this to 502. */
export class LlmParseError extends Error {
  constructor(
    message = 'The model did not return a valid structured response',
  ) {
    super(message);
    this.name = 'LlmParseError';
  }
}

/** A provider-side failure (network, auth, rate limit, bad input). `status` mirrors the upstream HTTP status when known. */
export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly usage?: LlmTokenUsage,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}

export const ZERO_USAGE: LlmTokenUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
};
