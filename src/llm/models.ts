// ---------------------------------------------------------------------------
// The single editable source of LLM provider/model metadata and pricing.
// Adding a provider = write an LlmProvider implementation (see provider.ts)
// and add its models here; adding a model on an already-registered provider
// is a pure data edit, no code change. Prices are USD per 1,000,000 tokens —
// verify against each provider's pricing page when adjusting; they change
// independently of this codebase.
// ---------------------------------------------------------------------------

export type ProviderId = 'anthropic' | 'google' | 'deepseek';
export type LlmTaskId = 'grading' | 'generation';

export interface ModelDef {
  /** Stable wire id — stored in User.gradingModel/generationModel and LlmUsage.model. */
  id: string;
  provider: ProviderId;
  /** The id string sent to the provider's API — may differ from `id`. */
  providerModelId: string;
  displayName: string;
  /** USD / 1,000,000 uncached input tokens. */
  inputPerMTok: number;
  /** USD / 1,000,000 cache-read input tokens. */
  cachedInputPerMTok: number;
  /** USD / 1,000,000 output tokens (including any reasoning/thinking tokens). */
  outputPerMTok: number;
  supportsPdf: boolean;
  /** 1 = fast/cheap, 2 = balanced, 3 = frontier. Used by the recommendation engine. */
  qualityTier: 1 | 2 | 3;
  /** Which task dropdowns this model is offered in. */
  tasks: LlmTaskId[];
}

export const GRADING_DEFAULT_MODEL = 'gemini-2.5-flash-lite';
export const GENERATION_DEFAULT_MODEL = 'gemini-2.5-flash';

export const MODELS: readonly ModelDef[] = [
  {
    id: 'claude-haiku-4-5',
    provider: 'anthropic',
    providerModelId: 'claude-haiku-4-5',
    displayName: 'Claude Haiku 4.5',
    inputPerMTok: 1,
    cachedInputPerMTok: 0.1,
    outputPerMTok: 5,
    supportsPdf: true,
    qualityTier: 1,
    tasks: ['grading'],
  },
  {
    id: 'claude-sonnet-4-6',
    provider: 'anthropic',
    providerModelId: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    inputPerMTok: 3,
    cachedInputPerMTok: 0.3,
    outputPerMTok: 15,
    supportsPdf: true,
    qualityTier: 2,
    tasks: ['grading', 'generation'],
  },
  {
    id: 'claude-opus-4-8',
    provider: 'anthropic',
    providerModelId: 'claude-opus-4-8',
    displayName: 'Claude Opus 4.8',
    inputPerMTok: 5,
    cachedInputPerMTok: 0.5,
    outputPerMTok: 25,
    supportsPdf: true,
    qualityTier: 3,
    tasks: ['generation'],
  },
  {
    id: 'gemini-2.5-flash-lite',
    provider: 'google',
    providerModelId: 'gemini-2.5-flash-lite',
    displayName: 'Gemini 2.5 Flash-Lite',
    inputPerMTok: 0.1,
    cachedInputPerMTok: 0.025,
    outputPerMTok: 0.4,
    supportsPdf: true,
    qualityTier: 1,
    tasks: ['grading'],
  },
  {
    id: 'gemini-2.5-flash',
    provider: 'google',
    providerModelId: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    inputPerMTok: 0.3,
    cachedInputPerMTok: 0.03,
    outputPerMTok: 2.5,
    supportsPdf: true,
    qualityTier: 2,
    tasks: ['grading', 'generation'],
  },
  {
    id: 'deepseek-v4-flash',
    provider: 'deepseek',
    providerModelId: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash',
    inputPerMTok: 0.14,
    cachedInputPerMTok: 0.0028,
    outputPerMTok: 0.28,
    supportsPdf: false,
    qualityTier: 1,
    tasks: ['grading', 'generation'],
  },
] as const;

export function getModel(id: string): ModelDef | undefined {
  return MODELS.find((m) => m.id === id);
}

export function modelsForTask(task: LlmTaskId): ModelDef[] {
  return MODELS.filter((m) => m.tasks.includes(task));
}

function defaultModelForTask(task: LlmTaskId): ModelDef {
  const id =
    task === 'grading' ? GRADING_DEFAULT_MODEL : GENERATION_DEFAULT_MODEL;
  const model = getModel(id);
  if (!model) {
    throw new Error(
      `Task default model "${id}" for "${task}" is not registered`,
    );
  }
  return model;
}

/**
 * Resolves a user's stored model preference to a registry entry, falling
 * back to the task default when the stored id is missing, unknown (e.g. a
 * model was removed from the registry), or no longer valid for this task.
 * This is what lets the registry change without a User-row migration.
 */
export function resolveModelForTask(
  storedId: string | null | undefined,
  task: LlmTaskId,
): ModelDef {
  if (!storedId) return defaultModelForTask(task);
  const model = getModel(storedId);
  if (!model || !model.tasks.includes(task)) return defaultModelForTask(task);
  return model;
}

export interface LlmTokenUsage {
  /** Uncached input tokens only — see provider adapters for normalization. */
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/**
 * costMicroUsd = tokens * (USD / 1e6 tokens) * 1e6 (micro-USD per USD)
 *              = tokens * USD-per-MTok-rate
 * i.e. multiplying token count by the per-MTok rate directly yields
 * micro-USD — the two 1e6 factors cancel.
 */
export function computeCostMicroUsd(
  model: ModelDef,
  usage: LlmTokenUsage,
): number {
  const cost =
    usage.inputTokens * model.inputPerMTok +
    usage.cachedInputTokens * model.cachedInputPerMTok +
    usage.outputTokens * model.outputPerMTok;
  return Math.round(cost);
}
