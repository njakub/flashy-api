/** The subset of an LlmUsage row that aggregate.ts/recommendation.ts operate on — kept narrow so tests can build fixtures without a real Prisma row. */
export interface UsageRow {
  task: 'GRADING' | 'GENERATION';
  provider: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  latencyMs: number;
  success: boolean;
  llmOutcome: string | null;
  localOutcome: string | null;
  userOverride: string | null;
  isPdfSource: boolean | null;
  createdAt: Date;
}
