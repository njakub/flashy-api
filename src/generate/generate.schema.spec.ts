import {
  generateRequestSchema,
  generateResponseSchema,
  MAX_SOURCE_TEXT_CHARS,
  MAX_PDF_BASE64_CHARS,
} from './generate.schema';

describe('generateRequestSchema — text source', () => {
  it('accepts a text source with a target count', () => {
    const result = generateRequestSchema.safeParse({
      source: { type: 'text', text: 'Closures capture their lexical scope.' },
      targetCount: 10,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty text', () => {
    const result = generateRequestSchema.safeParse({
      source: { type: 'text', text: '' },
      targetCount: 10,
    });
    expect(result.success).toBe(false);
  });

  it('rejects text over the char cap', () => {
    const result = generateRequestSchema.safeParse({
      source: { type: 'text', text: 'a'.repeat(MAX_SOURCE_TEXT_CHARS + 1) },
      targetCount: 10,
    });
    expect(result.success).toBe(false);
  });
});

describe('generateRequestSchema — pdf source', () => {
  it('accepts base64 data starting with the PDF magic bytes', () => {
    const result = generateRequestSchema.safeParse({
      source: { type: 'pdf', data: 'JVBERi0xLjQKJcOkw7zDtsOf' },
      targetCount: 5,
    });
    expect(result.success).toBe(true);
  });

  it('rejects base64 data that is not a PDF', () => {
    const result = generateRequestSchema.safeParse({
      source: { type: 'pdf', data: 'aGVsbG8gd29ybGQ=' },
      targetCount: 5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects pdf data over the size cap', () => {
    const result = generateRequestSchema.safeParse({
      source: {
        type: 'pdf',
        data: 'JVBERi' + 'A'.repeat(MAX_PDF_BASE64_CHARS),
      },
      targetCount: 5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown source type', () => {
    const result = generateRequestSchema.safeParse({
      source: { type: 'html', text: '<p>hi</p>' },
      targetCount: 5,
    });
    expect(result.success).toBe(false);
  });
});

describe('generateRequestSchema — targetCount', () => {
  const source = { type: 'text', text: 'some material' } as const;

  it.each([0, 21, 2.5])('rejects targetCount %p', (targetCount) => {
    const result = generateRequestSchema.safeParse({ source, targetCount });
    expect(result.success).toBe(false);
  });

  it.each([1, 20])('accepts targetCount %p', (targetCount) => {
    const result = generateRequestSchema.safeParse({ source, targetCount });
    expect(result.success).toBe(true);
  });
});

describe('generateResponseSchema', () => {
  it('accepts a mixed batch (short-answer + concept) and an empty batch', () => {
    const mixed = generateResponseSchema.safeParse({
      cards: [
        {
          front: 'What does `let` do?',
          back: 'Declares a block-scoped variable.',
          alternateAnswers: ['block-scoped variable declaration'],
          keyPoints: [],
          labels: ['javascript'],
        },
        {
          front: 'Explain how closures work.',
          back: 'A closure bundles a function with its lexical scope…',
          alternateAnswers: [],
          keyPoints: ['captures variables', 'persists after outer returns'],
          labels: ['javascript', 'closures'],
        },
      ],
    });
    expect(mixed.success).toBe(true);
    const empty = generateResponseSchema.safeParse({ cards: [] });
    expect(empty.success).toBe(true);
  });

  it('rejects a card missing required arrays', () => {
    const result = generateResponseSchema.safeParse({
      cards: [{ front: 'q', back: 'a' }],
    });
    expect(result.success).toBe(false);
  });
});
