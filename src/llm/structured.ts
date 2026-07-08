import { z } from 'zod';
import { LlmParseError } from './provider';

/**
 * Strips a markdown code fence a JSON-mode model sometimes wraps its output
 * in (```json ... ``` or bare ```), despite being asked for raw JSON.
 */
function stripFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

/**
 * Parses `raw` against `schema`, retrying once via `retry` (passed a
 * human-readable description of what was wrong) if the first attempt fails
 * to produce valid JSON or doesn't satisfy the schema. Used by providers
 * whose structured-output support is JSON-mode-only (Gemini, DeepSeek) —
 * Anthropic's native `zodOutputFormat` enforcement doesn't need this.
 * Throws LlmParseError if the retry also fails.
 */
export async function parseJsonWithRetry<T>(
  schema: z.ZodType<T>,
  raw: string,
  retry: (feedback: string) => Promise<string>,
): Promise<T> {
  const attempt = (
    text: string,
  ): { ok: true; value: T } | { ok: false; feedback: string } => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFence(text));
    } catch (err) {
      return {
        ok: false,
        feedback: `Your previous response was not valid JSON (${(err as Error).message}). Respond with ONLY the JSON object, no prose or markdown fences.`,
      };
    }
    const result = schema.safeParse(parsed);
    if (result.success) return { ok: true, value: result.data };
    return {
      ok: false,
      feedback: `Your previous JSON did not match the required schema: ${result.error.message}. Respond again with ONLY a corrected JSON object.`,
    };
  };

  const first = attempt(raw);
  if (first.ok) return first.value;

  const retryRaw = await retry(first.feedback);
  const second = attempt(retryRaw);
  if (second.ok) return second.value;

  throw new LlmParseError(
    `Model did not return schema-valid JSON after a retry: ${second.feedback}`,
  );
}
