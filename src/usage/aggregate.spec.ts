import { buildDailySeries, computeTotals, summarizeByModel } from './aggregate';
import type { UsageRow } from './usage.types';

function row(overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    task: 'GRADING',
    provider: 'google',
    model: 'gemini-2.5-flash-lite',
    inputTokens: 100,
    cachedInputTokens: 0,
    outputTokens: 20,
    costMicroUsd: 100,
    latencyMs: 500,
    success: true,
    llmOutcome: 'correct',
    localOutcome: null,
    userOverride: null,
    isPdfSource: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

describe('computeTotals', () => {
  it('sums cost, counts calls and failures', () => {
    const totals = computeTotals([
      row({ costMicroUsd: 1_000_000, success: true }),
      row({ costMicroUsd: 500_000, success: false }),
    ]);
    expect(totals).toEqual({ costUsd: 1.5, calls: 2, failedCalls: 1 });
  });

  it('returns zeros for an empty range', () => {
    expect(computeTotals([])).toEqual({ costUsd: 0, calls: 0, failedCalls: 0 });
  });
});

describe('summarizeByModel', () => {
  it('groups by model+task and computes per-group stats', () => {
    const rows = [
      row({ model: 'a', task: 'GRADING', costMicroUsd: 100, latencyMs: 100 }),
      row({ model: 'a', task: 'GRADING', costMicroUsd: 300, latencyMs: 300 }),
      row({
        model: 'b',
        task: 'GENERATION',
        costMicroUsd: 1000,
        latencyMs: 1000,
      }),
    ];
    const summary = summarizeByModel(rows);
    expect(summary).toHaveLength(2);

    const a = summary.find((s) => s.model === 'a')!;
    expect(a.calls).toBe(2);
    expect(a.costUsd).toBeCloseTo(0.0004);
    expect(a.avgLatencyMs).toBe(200);
    expect(a.task).toBe('grading');

    const b = summary.find((s) => s.model === 'b')!;
    expect(b.task).toBe('generation');
    expect(b.agreement).toBeNull();
  });

  it('computes userAgreeRate from feedback-carrying rows only', () => {
    const rows = [
      row({ model: 'a', llmOutcome: 'correct', userOverride: 'correct' }),
      row({ model: 'a', llmOutcome: 'incorrect', userOverride: 'correct' }),
      row({ model: 'a', llmOutcome: 'correct', userOverride: null }), // no feedback — excluded
    ];
    const [summary] = summarizeByModel(rows);
    expect(summary.agreement!.userSamples).toBe(2);
    expect(summary.agreement!.userAgreeRate).toBeCloseTo(0.5);
  });

  it('computes localDisagreeRate from escalated (correct/incorrect) local outcomes only', () => {
    const rows = [
      row({ model: 'a', llmOutcome: 'correct', localOutcome: 'correct' }),
      row({ model: 'a', llmOutcome: 'incorrect', localOutcome: 'correct' }),
      row({ model: 'a', llmOutcome: 'correct', localOutcome: 'ambiguous' }), // not correct/incorrect — excluded
    ];
    const [summary] = summarizeByModel(rows);
    expect(summary.agreement!.localSamples).toBe(2);
    expect(summary.agreement!.localDisagreeRate).toBeCloseTo(0.5);
  });

  it('returns null agreement fields when there is no feedback or escalation data', () => {
    const [summary] = summarizeByModel([row({ model: 'a' })]);
    expect(summary.agreement).toEqual({
      userAgreeRate: null,
      userSamples: 0,
      localDisagreeRate: null,
      localSamples: 0,
    });
  });
});

describe('buildDailySeries', () => {
  it('buckets by UTC calendar day, sorted ascending', () => {
    const series = buildDailySeries([
      row({
        model: 'a',
        costMicroUsd: 1_000_000,
        createdAt: new Date('2026-07-02T10:00:00Z'),
      }),
      row({
        model: 'a',
        costMicroUsd: 2_000_000,
        createdAt: new Date('2026-07-01T10:00:00Z'),
      }),
      row({
        model: 'b',
        costMicroUsd: 500_000,
        createdAt: new Date('2026-07-01T23:00:00Z'),
      }),
    ]);
    expect(series.map((p) => p.date)).toEqual(['2026-07-01', '2026-07-02']);
    expect(series[0].calls).toBe(2);
    expect(series[0].costUsdByModel).toEqual({ a: 2, b: 0.5 });
    expect(series[1].costUsdByModel).toEqual({ a: 1 });
  });
});
