import {
  computeCostMicroUsd,
  type ModelDef,
  type LlmTaskId,
} from '../llm/models';
import { computeAgreement } from './aggregate';
import type { UsageRow } from './usage.types';

export interface Recommendation {
  task: LlmTaskId;
  currentModel: string;
  recommendedModel: string;
  estCallsPerMonth: number;
  currentMonthlyCostUsd: number;
  projectedMonthlyCostUsd: number;
  projectedMonthlySavingsUsd: number;
  qualityNote: string;
  reason: string;
}

const WINDOW_DAYS = 30;
const GRADING_VOLUME_GATE = 50;
const GENERATION_VOLUME_GATE = 5;
const MIN_SAVINGS_USD = 0.5;
const GRADING_SAVINGS_PCT = 0.2;
const AGREEMENT_TOLERANCE = 0.05;
const MIN_AGREEMENT_SAMPLES = 30;
const MIN_MODEL_PROFILE_ROWS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const average = (values: number[]): number =>
  values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Deterministic, rule-based per-task model recommendation from the user's
 * own recent usage — no LLM call. See the per-task eligibility rules below:
 * grading optimizes for cost (never trading meaningfully below the current
 * model's demonstrated accuracy), generation never drops quality tier
 * regardless of price, matching "grading is high-volume/cost-sensitive,
 * generation is low-volume/quality-sensitive".
 */
export function computeRecommendations(
  rows: UsageRow[],
  settings: { gradingModel: string; generationModel: string },
  allModels: readonly ModelDef[],
): Recommendation[] {
  const windowStart = Date.now() - WINDOW_DAYS * DAY_MS;
  const inWindow = rows.filter(
    (r) => r.success && r.createdAt.getTime() >= windowStart,
  );

  const recommendations: Recommendation[] = [];
  const grading = computeTaskRecommendation(
    'GRADING',
    'grading',
    settings.gradingModel,
    inWindow,
    allModels,
    GRADING_VOLUME_GATE,
  );
  if (grading) recommendations.push(grading);

  const generation = computeTaskRecommendation(
    'GENERATION',
    'generation',
    settings.generationModel,
    inWindow,
    allModels,
    GENERATION_VOLUME_GATE,
  );
  if (generation) recommendations.push(generation);

  return recommendations;
}

/** Cost of ONE representative call on `target`, given the observed per-call token averages against `currentProvider`. */
function projectedMonthlyCost(
  currentProvider: string,
  target: ModelDef,
  avgIn: number,
  avgCached: number,
  avgOut: number,
  estCallsPerMonth: number,
): number {
  // Cache behavior doesn't transfer across providers — folding it into
  // uncached input is the conservative (not overly favorable) estimate.
  const sameProvider = currentProvider === target.provider;
  const effectiveIn = sameProvider ? avgIn : avgIn + avgCached;
  const effectiveCached = sameProvider ? avgCached : 0;
  const perCallMicroUsd = computeCostMicroUsd(target, {
    inputTokens: effectiveIn,
    cachedInputTokens: effectiveCached,
    outputTokens: avgOut,
  });
  return (perCallMicroUsd * estCallsPerMonth) / 1e6;
}

function computeTaskRecommendation(
  dbTask: 'GRADING' | 'GENERATION',
  taskId: LlmTaskId,
  currentModelId: string,
  windowRows: UsageRow[],
  allModels: readonly ModelDef[],
  volumeGate: number,
): Recommendation | null {
  const taskRows = windowRows.filter((r) => r.task === dbTask);
  if (taskRows.length < volumeGate) return null;

  const current = allModels.find((m) => m.id === currentModelId);
  if (!current) return null; // stale/unknown setting — resolveModelForTask already falls back elsewhere

  const earliestMs = Math.min(...taskRows.map((r) => r.createdAt.getTime()));
  const daysObserved = Math.max(
    1,
    Math.min(WINDOW_DAYS, (Date.now() - earliestMs) / DAY_MS),
  );
  const estCallsPerMonth = (taskRows.length / daysObserved) * 30;

  const currentRows = taskRows.filter((r) => r.model === currentModelId);
  const profileRows =
    currentRows.length >= MIN_MODEL_PROFILE_ROWS ? currentRows : taskRows;
  const avgIn = average(profileRows.map((r) => r.inputTokens));
  const avgCached = average(profileRows.map((r) => r.cachedInputTokens));
  const avgOut = average(profileRows.map((r) => r.outputTokens));

  const currentMonthlyCostUsd = projectedMonthlyCost(
    current.provider,
    current,
    avgIn,
    avgCached,
    avgOut,
    estCallsPerMonth,
  );

  const candidates = allModels.filter(
    (m) => m.id !== currentModelId && m.tasks.includes(taskId),
  );

  let eligible: { model: ModelDef; qualityNote: string }[];
  if (taskId === 'grading') {
    eligible = candidates.flatMap((c) => {
      if (c.qualityTier >= current.qualityTier) {
        return [{ model: c, qualityNote: 'same or higher quality tier' }];
      }
      if (c.qualityTier === current.qualityTier - 1) {
        const candidateAgreement = computeAgreement(
          taskRows.filter((r) => r.model === c.id),
        );
        const currentAgreement = computeAgreement(currentRows);
        if (
          candidateAgreement.userSamples >= MIN_AGREEMENT_SAMPLES &&
          candidateAgreement.userAgreeRate !== null &&
          currentAgreement.userAgreeRate !== null &&
          candidateAgreement.userAgreeRate >=
            currentAgreement.userAgreeRate - AGREEMENT_TOLERANCE
        ) {
          return [
            {
              model: c,
              qualityNote: `${Math.round(candidateAgreement.userAgreeRate * 100)}% user-agreement over ${candidateAgreement.userSamples} graded answers, comparable to your current model`,
            },
          ];
        }
      }
      return [];
    });
  } else {
    const anyPdf = taskRows.some((r) => r.isPdfSource === true);
    eligible = candidates
      .filter(
        (c) =>
          c.qualityTier >= current.qualityTier && (!anyPdf || c.supportsPdf),
      )
      .map((c) => ({ model: c, qualityNote: 'same or higher quality tier' }));
  }
  if (eligible.length === 0) return null;

  const projected = eligible.map((e) => ({
    ...e,
    cost: projectedMonthlyCost(
      current.provider,
      e.model,
      avgIn,
      avgCached,
      avgOut,
      estCallsPerMonth,
    ),
  }));
  projected.sort((a, b) => a.cost - b.cost);
  const best = projected[0];

  const savings = currentMonthlyCostUsd - best.cost;
  const minSavings =
    taskId === 'grading'
      ? Math.max(MIN_SAVINGS_USD, currentMonthlyCostUsd * GRADING_SAVINGS_PCT)
      : MIN_SAVINGS_USD;
  if (savings < minSavings) return null;

  const verb = taskId === 'grading' ? 'grading' : 'generating';
  const reason = `You're ${verb} ~${Math.round(estCallsPerMonth)} calls/month on ${current.displayName}; ${best.model.displayName} would cost about $${round2(savings).toFixed(2)}/month less (${best.qualityNote}).`;

  return {
    task: taskId,
    currentModel: currentModelId,
    recommendedModel: best.model.id,
    estCallsPerMonth: Math.round(estCallsPerMonth),
    currentMonthlyCostUsd: round2(currentMonthlyCostUsd),
    projectedMonthlyCostUsd: round2(best.cost),
    projectedMonthlySavingsUsd: round2(savings),
    qualityNote: best.qualityNote,
    reason,
  };
}
