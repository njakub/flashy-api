import { computeRecommendations } from './recommendation';
import { MODELS, type ModelDef } from '../llm/models';
import type { UsageRow } from './usage.types';

function row(overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    task: 'GRADING',
    provider: 'anthropic',
    model: 'x',
    inputTokens: 200,
    cachedInputTokens: 0,
    outputTokens: 40,
    costMicroUsd: 1000,
    latencyMs: 500,
    success: true,
    llmOutcome: 'correct',
    localOutcome: null,
    userOverride: null,
    isPdfSource: null,
    // All rows default to "now" — with every row inside the same day, the
    // engine's daysObserved clamps to its 1-day floor, so
    // estCallsPerMonth = calls * 30 deterministically, independent of the
    // wall-clock date the test happens to run on.
    createdAt: new Date(),
    ...overrides,
  };
}

function repeat(
  n: number,
  build: (i: number) => Partial<UsageRow>,
): UsageRow[] {
  return Array.from({ length: n }, (_, i) => row(build(i)));
}

// A small synthetic registry for precise control over tier/price/PDF
// branches, independent of how the real registry happens to be priced.
const cheap1: ModelDef = {
  id: 'cheap-tier1',
  provider: 'google',
  providerModelId: 'cheap-tier1',
  displayName: 'Cheap Tier 1',
  inputPerMTok: 0.1,
  cachedInputPerMTok: 0.01,
  outputPerMTok: 0.1,
  supportsPdf: false,
  qualityTier: 1,
  tasks: ['grading', 'generation'],
};
const mid2: ModelDef = {
  id: 'mid-tier2',
  provider: 'anthropic',
  providerModelId: 'mid-tier2',
  displayName: 'Mid Tier 2',
  inputPerMTok: 1,
  cachedInputPerMTok: 0.1,
  outputPerMTok: 1,
  supportsPdf: true,
  qualityTier: 2,
  tasks: ['grading', 'generation'],
};
const expensive2: ModelDef = {
  id: 'expensive-tier2',
  provider: 'anthropic',
  providerModelId: 'expensive-tier2',
  displayName: 'Expensive Tier 2',
  inputPerMTok: 5,
  cachedInputPerMTok: 0.5,
  outputPerMTok: 5,
  supportsPdf: true,
  qualityTier: 2,
  tasks: ['grading', 'generation'],
};
const pdfCapableTier2: ModelDef = {
  ...mid2,
  id: 'pdf-tier2',
  displayName: 'PDF Tier 2',
  inputPerMTok: 0.5,
};

describe('computeRecommendations — volume gates', () => {
  it('does not recommend grading below the 50-call gate', () => {
    const rows = repeat(49, () => ({ model: expensive2.id }));
    const recs = computeRecommendations(
      rows,
      { gradingModel: expensive2.id, generationModel: mid2.id },
      [mid2, expensive2, cheap1],
    );
    expect(recs.find((r) => r.task === 'grading')).toBeUndefined();
  });

  it('does not recommend generation below the 5-call gate', () => {
    const rows = repeat(4, () => ({
      task: 'GENERATION' as const,
      model: expensive2.id,
    }));
    const recs = computeRecommendations(
      rows,
      { gradingModel: mid2.id, generationModel: expensive2.id },
      [mid2, expensive2],
    );
    expect(recs.find((r) => r.task === 'generation')).toBeUndefined();
  });
});

describe('computeRecommendations — grading (cost-sensitive)', () => {
  it('recommends a same-tier-or-higher cheaper model without needing agreement data', () => {
    const rows = repeat(60, () => ({ model: expensive2.id }));
    const recs = computeRecommendations(
      rows,
      { gradingModel: expensive2.id, generationModel: mid2.id },
      [mid2, expensive2, cheap1],
    );
    const grading = recs.find((r) => r.task === 'grading');
    expect(grading?.recommendedModel).toBe(mid2.id);
    expect(grading?.projectedMonthlySavingsUsd).toBeGreaterThan(0);
  });

  it('does not downgrade a tier without sufficient supporting agreement data', () => {
    const rows = repeat(60, () => ({ model: mid2.id }));
    const recs = computeRecommendations(
      rows,
      { gradingModel: mid2.id, generationModel: mid2.id },
      [mid2, cheap1], // cheap1 is one tier below mid2
    );
    expect(recs.find((r) => r.task === 'grading')).toBeUndefined();
  });

  it('downgrades a tier when the lower-tier candidate has 30+ samples within 5 points of the current model', () => {
    const currentRows = repeat(60, (i) => ({
      model: mid2.id,
      // 36/40 feedback rows agree -> ~90% userAgreeRate, leaving room for a
      // candidate within the 5-point tolerance without hitting 100%.
      userOverride: i < 40 ? (i < 36 ? 'correct' : 'incorrect') : null,
      llmOutcome: 'correct',
    }));
    const candidateRows = repeat(35, (i) => ({
      model: cheap1.id,
      userOverride: i < 32 ? 'correct' : 'incorrect', // ~91% agreement
      llmOutcome: 'correct',
    }));
    const recs = computeRecommendations(
      [...currentRows, ...candidateRows],
      { gradingModel: mid2.id, generationModel: mid2.id },
      [mid2, cheap1],
    );
    const grading = recs.find((r) => r.task === 'grading');
    expect(grading?.recommendedModel).toBe(cheap1.id);
  });

  it('does not recommend when projected savings are below the threshold', () => {
    const rows = repeat(60, () => ({ model: mid2.id }));
    const almostSamePrice: ModelDef = {
      ...mid2,
      id: 'mid2-clone',
      inputPerMTok: 0.95,
    };
    const recs = computeRecommendations(
      rows,
      { gradingModel: mid2.id, generationModel: mid2.id },
      [mid2, almostSamePrice],
    );
    expect(recs.find((r) => r.task === 'grading')).toBeUndefined();
  });
});

describe('computeRecommendations — generation (quality-sensitive)', () => {
  it('never recommends a lower quality tier regardless of price', () => {
    const rows = repeat(10, () => ({
      task: 'GENERATION' as const,
      model: mid2.id,
    }));
    const recs = computeRecommendations(
      rows,
      { gradingModel: mid2.id, generationModel: mid2.id },
      [mid2, cheap1], // cheap1 is cheaper but a lower tier
    );
    expect(recs.find((r) => r.task === 'generation')).toBeUndefined();
  });

  it('excludes a same-tier candidate that cannot handle PDFs when the window includes a PDF call', () => {
    const rows = repeat(10, (i) => ({
      task: 'GENERATION' as const,
      model: expensive2.id,
      // PDF generation is large-context — realistic token counts so the
      // absolute dollar gap clears the flat $0.50/month savings floor.
      inputTokens: 2000,
      outputTokens: 400,
      isPdfSource: i === 0, // at least one PDF call in the window
    }));
    const cheapNoPdfTier2: ModelDef = {
      ...cheap1,
      id: 'cheap-no-pdf-tier2',
      qualityTier: 2,
    };
    const recs = computeRecommendations(
      rows,
      { gradingModel: mid2.id, generationModel: expensive2.id },
      [expensive2, pdfCapableTier2, cheapNoPdfTier2],
    );
    const generation = recs.find((r) => r.task === 'generation');
    // The cheapest same-tier candidate lacks PDF support, so it must be
    // skipped in favor of the PDF-capable one even though it costs more.
    expect(generation?.recommendedModel).toBe(pdfCapableTier2.id);
  });

  it('allows a non-PDF-capable candidate when no PDF calls occurred in the window', () => {
    const rows = repeat(10, () => ({
      task: 'GENERATION' as const,
      model: expensive2.id,
      inputTokens: 2000,
      outputTokens: 400,
    }));
    const cheapNoPdfSameTier: ModelDef = {
      ...cheap1,
      id: 'cheap-no-pdf',
      qualityTier: 2,
    };
    const recs = computeRecommendations(
      rows,
      { gradingModel: mid2.id, generationModel: expensive2.id },
      [expensive2, cheapNoPdfSameTier],
    );
    const generation = recs.find((r) => r.task === 'generation');
    expect(generation?.recommendedModel).toBe(cheapNoPdfSameTier.id);
  });
});

describe('computeRecommendations — acceptance scenarios against the real registry', () => {
  it('grading on Sonnet only recommends Flash-Lite once agreement data supports it', () => {
    const sonnetRows = repeat(60, (i) => ({
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      // 41/45 feedback rows agree -> ~91% userAgreeRate, leaving room for a
      // candidate within the 5-point tolerance without hitting 100%.
      userOverride: i < 45 ? (i < 41 ? 'correct' : 'incorrect') : null,
      llmOutcome: 'correct',
    }));

    const withoutSupport = computeRecommendations(
      sonnetRows,
      {
        gradingModel: 'claude-sonnet-4-6',
        generationModel: 'gemini-2.5-flash',
      },
      MODELS,
    );
    const gradingWithoutSupport = withoutSupport.find(
      (r) => r.task === 'grading',
    );
    expect(gradingWithoutSupport?.recommendedModel).not.toBe(
      'gemini-2.5-flash-lite',
    );

    const flashLiteAgreementRows = repeat(35, (i) => ({
      model: 'gemini-2.5-flash-lite',
      provider: 'google',
      userOverride: i < 32 ? 'correct' : 'incorrect', // ~91%, within 5 points of Sonnet's ~91%
      llmOutcome: 'correct',
    }));
    const withSupport = computeRecommendations(
      [...sonnetRows, ...flashLiteAgreementRows],
      {
        gradingModel: 'claude-sonnet-4-6',
        generationModel: 'gemini-2.5-flash',
      },
      MODELS,
    );
    const gradingWithSupport = withSupport.find((r) => r.task === 'grading');
    expect(gradingWithSupport?.recommendedModel).toBe('gemini-2.5-flash-lite');
  });

  it('generation on Opus with PDFs in the window never recommends DeepSeek', () => {
    // DeepSeek is the registry's only non-PDF-capable model and its lowest
    // quality tier, so it can never be tier-eligible against a higher-tier
    // current model like Opus — the tier rule alone keeps it out, and the
    // PDF-capability rule is a second, independent line of defense.
    const rows = repeat(10, (i) => ({
      task: 'GENERATION' as const,
      model: 'claude-opus-4-8',
      provider: 'anthropic',
      isPdfSource: i < 5,
    }));
    const recs = computeRecommendations(
      rows,
      {
        gradingModel: 'gemini-2.5-flash-lite',
        generationModel: 'claude-opus-4-8',
      },
      MODELS,
    );
    const generation = recs.find((r) => r.task === 'generation');
    expect(generation?.recommendedModel).not.toBe('deepseek-v4-flash');
  });
});
