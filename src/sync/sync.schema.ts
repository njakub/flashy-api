import { z } from 'zod';

// ---------------------------------------------------------------------------
// Wire protocol for POST /sync — one push+pull round trip.
//
// `rev` values are BigInt server-side; JSON can't carry full BigInt
// precision, so they cross the wire as decimal strings. Dates cross as ISO
// strings, matching the client's existing convention (Card.createdAt etc.
// are already ISO strings in the Dexie domain types).
// ---------------------------------------------------------------------------

const revString = z.string().regex(/^\d+$/, 'rev must be a decimal string');

export const syncCursorSchema = z.object({
  decks: revString.default('0'),
  cards: revString.default('0'),
  testRuns: revString.default('0'),
  testRunQuestions: revString.default('0'),
});
export type SyncCursor = z.infer<typeof syncCursorSchema>;

const pushDeckSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type PushDeck = z.infer<typeof pushDeckSchema>;

const pushCardSchema = z.object({
  id: z.string().min(1),
  deckId: z.string().min(1),
  front: z.string(),
  back: z.string(),
  alternateAnswers: z.array(z.string()),
  answerJustifications: z.record(z.string(), z.string()).optional(),
  labels: z.array(z.string()),
  // Rubric for concept cards — optional/additive. Absent means "an old
  // client pushed this row and doesn't know the field", NOT "clear it";
  // see SyncService.applyCard for the absent-vs-empty-array distinction.
  keyPoints: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  scheduling: z.object({
    easeFactor: z.number(),
    intervalDays: z.number(),
    dueAt: z.string(),
    reps: z.number(),
    lapses: z.number(),
    lastReviewedAt: z.string().nullable(),
  }),
});
export type PushCard = z.infer<typeof pushCardSchema>;

const pushTestRunSchema = z.object({
  id: z.string().min(1),
  deckId: z.string().min(1),
  startedAt: z.string(),
  completedAt: z.string(),
  questionCount: z.number().int(),
  correctCount: z.number().int(),
  deletedAt: z.string().nullable(),
});
export type PushTestRun = z.infer<typeof pushTestRunSchema>;

const pushTestRunQuestionSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  cardId: z.string().min(1),
  cardFrontSnapshot: z.string(),
  cardBackSnapshot: z.string(),
  userAnswer: z.string(),
  outcome: z.enum(['correct', 'incorrect']),
  similarity: z.number().optional(),
});
export type PushTestRunQuestion = z.infer<typeof pushTestRunQuestionSchema>;

export const syncRequestSchema = z.object({
  cursor: syncCursorSchema,
  push: z.object({
    decks: z.array(pushDeckSchema).default([]),
    cards: z.array(pushCardSchema).default([]),
    testRuns: z.array(pushTestRunSchema).default([]),
    testRunQuestions: z.array(pushTestRunQuestionSchema).default([]),
  }),
});
export type SyncRequest = z.infer<typeof syncRequestSchema>;
