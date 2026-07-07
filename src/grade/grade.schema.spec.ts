import {
  gradeRequestSchema,
  gradeResponseSchema,
  conceptGradeResponseSchema,
} from './grade.schema';

describe('gradeRequestSchema — keyPoints', () => {
  const base = {
    question: 'What are closures?',
    acceptedAnswers: ['A closure bundles a function with its lexical scope.'],
    userAnswer: 'A closure remembers variables from where it was created.',
  };

  it('accepts a request without keyPoints', () => {
    const result = gradeRequestSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.keyPoints).toBeUndefined();
  });

  it('accepts a request with keyPoints', () => {
    const result = gradeRequestSchema.safeParse({
      ...base,
      keyPoints: ['captures variables', 'persists scope'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.keyPoints).toEqual([
        'captures variables',
        'persists scope',
      ]);
    }
  });

  it('rejects an empty-string key point', () => {
    const result = gradeRequestSchema.safeParse({
      ...base,
      keyPoints: ['ok', ''],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 20 key points', () => {
    const result = gradeRequestSchema.safeParse({
      ...base,
      keyPoints: Array.from({ length: 21 }, (_, i) => `point ${i}`),
    });
    expect(result.success).toBe(false);
  });
});

describe('gradeResponseSchema / conceptGradeResponseSchema', () => {
  it('gradeResponseSchema accepts a plain outcome/rationale response', () => {
    const result = gradeResponseSchema.safeParse({
      outcome: 'correct',
      rationale: 'Matches the accepted answer.',
    });
    expect(result.success).toBe(true);
  });

  it('conceptGradeResponseSchema requires coverage', () => {
    const result = conceptGradeResponseSchema.safeParse({
      outcome: 'correct',
      rationale: 'Covers the essential points.',
    });
    expect(result.success).toBe(false);
  });

  it('conceptGradeResponseSchema accepts outcome/rationale/coverage', () => {
    const result = conceptGradeResponseSchema.safeParse({
      outcome: 'incorrect',
      rationale: 'Missing the microtask queue point.',
      coverage: [
        { point: 'captures variables', covered: true },
        { point: 'persists scope', covered: false },
      ],
    });
    expect(result.success).toBe(true);
  });
});
