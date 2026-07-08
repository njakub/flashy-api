import {
  computeCostMicroUsd,
  getModel,
  GRADING_DEFAULT_MODEL,
  GENERATION_DEFAULT_MODEL,
  resolveModelForTask,
} from './models';

describe('resolveModelForTask', () => {
  it('falls back to the task default when storedId is null/undefined', () => {
    expect(resolveModelForTask(null, 'grading').id).toBe(GRADING_DEFAULT_MODEL);
    expect(resolveModelForTask(undefined, 'generation').id).toBe(
      GENERATION_DEFAULT_MODEL,
    );
  });

  it('falls back to the task default when storedId is unknown (removed from registry)', () => {
    expect(resolveModelForTask('some-retired-model', 'grading').id).toBe(
      GRADING_DEFAULT_MODEL,
    );
  });

  it('falls back to the task default when the stored model exists but is not valid for this task', () => {
    // claude-opus-4-8 is generation-only in the registry.
    expect(resolveModelForTask('claude-opus-4-8', 'grading').id).toBe(
      GRADING_DEFAULT_MODEL,
    );
  });

  it('resolves a valid stored model for the task', () => {
    expect(resolveModelForTask('deepseek-v4-flash', 'grading').id).toBe(
      'deepseek-v4-flash',
    );
    expect(resolveModelForTask('claude-opus-4-8', 'generation').id).toBe(
      'claude-opus-4-8',
    );
  });
});

describe('computeCostMicroUsd', () => {
  it('computes cost across uncached, cached, and output tokens (Anthropic-shaped usage)', () => {
    const model = getModel('claude-haiku-4-5')!;
    // 1,000,000 uncached input + 1,000,000 cached input + 1,000,000 output
    // = $1 + $0.10 + $5 = $6.10 -> 6_100_000 micro-USD.
    const cost = computeCostMicroUsd(model, {
      inputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBe(6_100_000);
  });

  it('computes cost for a small realistic grading call', () => {
    const model = getModel('gemini-2.5-flash-lite')!;
    // 200 input, 0 cached, 40 output at $0.10/$0.40 per MTok.
    const cost = computeCostMicroUsd(model, {
      inputTokens: 200,
      cachedInputTokens: 0,
      outputTokens: 40,
    });
    // 200 * 0.10 + 40 * 0.40 = 20 + 16 = 36 micro-USD.
    expect(cost).toBe(36);
  });

  it('rounds to the nearest whole micro-USD', () => {
    const model = getModel('deepseek-v4-flash')!;
    const cost = computeCostMicroUsd(model, {
      inputTokens: 3,
      cachedInputTokens: 0,
      outputTokens: 0,
    });
    // 3 * 0.14 = 0.42 -> rounds to 0.
    expect(cost).toBe(0);
  });
});
