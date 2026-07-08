import { getModel } from '../llm/models';
import type { UsageRow } from './usage.types';

export interface Totals {
  costUsd: number;
  calls: number;
  failedCalls: number;
}

export interface AgreementSummary {
  userAgreeRate: number | null;
  userSamples: number;
  localDisagreeRate: number | null;
  localSamples: number;
}

export interface ModelSummary {
  model: string;
  provider: string;
  displayName: string;
  task: 'grading' | 'generation';
  calls: number;
  costUsd: number;
  avgCostPerCallUsd: number;
  avgLatencyMs: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  /** Only populated for grading rows — null for generation. */
  agreement: AgreementSummary | null;
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD, UTC
  costUsdByModel: Record<string, number>;
  calls: number;
}

const toTaskId = (task: 'GRADING' | 'GENERATION'): 'grading' | 'generation' =>
  task === 'GRADING' ? 'grading' : 'generation';

export function computeTotals(rows: UsageRow[]): Totals {
  return {
    costUsd: rows.reduce((sum, r) => sum + r.costMicroUsd, 0) / 1e6,
    calls: rows.length,
    failedCalls: rows.filter((r) => !r.success).length,
  };
}

/** Exported for reuse by recommendation.ts, which needs per-candidate-model agreement, not just per-summary-group. */
export function computeAgreement(rows: UsageRow[]): AgreementSummary {
  const withFeedback = rows.filter((r) => r.userOverride !== null);
  const userAgreeRate =
    withFeedback.length > 0
      ? withFeedback.filter((r) => r.userOverride === r.llmOutcome).length /
        withFeedback.length
      : null;

  const escalated = rows.filter(
    (r) => r.localOutcome === 'correct' || r.localOutcome === 'incorrect',
  );
  const localDisagreeRate =
    escalated.length > 0
      ? escalated.filter((r) => r.localOutcome !== r.llmOutcome).length /
        escalated.length
      : null;

  return {
    userAgreeRate,
    userSamples: withFeedback.length,
    localDisagreeRate,
    localSamples: escalated.length,
  };
}

/** Groups by model+task and computes per-model stats — the "byModel" section of GET /usage/summary. */
export function summarizeByModel(rows: UsageRow[]): ModelSummary[] {
  const groups = new Map<string, UsageRow[]>();
  for (const row of rows) {
    const key = `${row.model}|${row.task}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const summaries: ModelSummary[] = [];
  for (const group of groups.values()) {
    const [{ model, provider, task }] = group;
    const costUsd = group.reduce((sum, r) => sum + r.costMicroUsd, 0) / 1e6;
    const calls = group.length;
    summaries.push({
      model,
      provider,
      displayName: getModel(model)?.displayName ?? model,
      task: toTaskId(task),
      calls,
      costUsd,
      avgCostPerCallUsd: calls > 0 ? costUsd / calls : 0,
      avgLatencyMs:
        calls > 0 ? group.reduce((sum, r) => sum + r.latencyMs, 0) / calls : 0,
      inputTokens: group.reduce((sum, r) => sum + r.inputTokens, 0),
      cachedInputTokens: group.reduce((sum, r) => sum + r.cachedInputTokens, 0),
      outputTokens: group.reduce((sum, r) => sum + r.outputTokens, 0),
      agreement: task === 'GRADING' ? computeAgreement(group) : null,
    });
  }
  return summaries;
}

/** Buckets rows by UTC calendar day for a stacked-cost-by-model chart. */
export function buildDailySeries(rows: UsageRow[]): DailyPoint[] {
  const byDate = new Map<
    string,
    { costUsdByModel: Record<string, number>; calls: number }
  >();
  for (const row of rows) {
    const date = row.createdAt.toISOString().slice(0, 10);
    let point = byDate.get(date);
    if (!point) {
      point = { costUsdByModel: {}, calls: 0 };
      byDate.set(date, point);
    }
    point.calls += 1;
    point.costUsdByModel[row.model] =
      (point.costUsdByModel[row.model] ?? 0) + row.costMicroUsd / 1e6;
  }
  return Array.from(byDate.entries())
    .map(([date, point]) => ({ date, ...point }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
