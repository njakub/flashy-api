import { syncRequestSchema } from './sync.schema';

function baseCard(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    deckId: 'd1',
    front: 'front',
    back: 'back',
    alternateAnswers: [],
    labels: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    scheduling: {
      easeFactor: 2.5,
      intervalDays: 1,
      dueAt: '2026-01-02T00:00:00.000Z',
      reps: 1,
      lapses: 0,
      lastReviewedAt: null,
    },
    ...overrides,
  };
}

function requestWith(cards: unknown[]) {
  return {
    cursor: { decks: '0', cards: '0', testRuns: '0', testRunQuestions: '0' },
    push: { decks: [], cards, testRuns: [], testRunQuestions: [] },
  };
}

describe('pushCardSchema — keyPoints', () => {
  it('accepts a card with keyPoints present', () => {
    const result = syncRequestSchema.safeParse(
      requestWith([baseCard({ keyPoints: ['point 1', 'point 2'] })]),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.push.cards[0].keyPoints).toEqual([
        'point 1',
        'point 2',
      ]);
    }
  });

  it('accepts a card with keyPoints absent — parses to undefined, not []', () => {
    const result = syncRequestSchema.safeParse(requestWith([baseCard()]));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.push.cards[0].keyPoints).toBeUndefined();
    }
  });

  it('accepts an explicit empty array (a legitimate clear)', () => {
    const result = syncRequestSchema.safeParse(
      requestWith([baseCard({ keyPoints: [] })]),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.push.cards[0].keyPoints).toEqual([]);
    }
  });

  it('rejects non-string entries', () => {
    const result = syncRequestSchema.safeParse(
      requestWith([baseCard({ keyPoints: ['ok', 42] })]),
    );
    expect(result.success).toBe(false);
  });
});

describe('pushCardSchema — unknown fields', () => {
  it('silently strips unknown keys rather than rejecting the row', () => {
    const result = syncRequestSchema.safeParse(
      requestWith([baseCard({ notARealField: 'surprise' })]),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(
        (result.data.push.cards[0] as Record<string, unknown>).notARealField,
      ).toBeUndefined();
    }
  });
});
