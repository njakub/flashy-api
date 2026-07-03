export interface WireDeck {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  rev: string;
}

export interface WireCard {
  id: string;
  ownerId: string;
  deckId: string;
  front: string;
  back: string;
  alternateAnswers: string[];
  answerJustifications?: Record<string, string>;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  rev: string;
  scheduling: {
    easeFactor: number;
    intervalDays: number;
    dueAt: string;
    reps: number;
    lapses: number;
    lastReviewedAt: string | null;
  };
}

export interface WireTestRun {
  id: string;
  ownerId: string;
  deckId: string;
  startedAt: string;
  completedAt: string;
  questionCount: number;
  correctCount: number;
  deletedAt: string | null;
  rev: string;
}

export interface WireTestRunQuestion {
  id: string;
  runId: string;
  cardId: string;
  cardFrontSnapshot: string;
  cardBackSnapshot: string;
  userAnswer: string;
  outcome: 'correct' | 'incorrect';
  similarity?: number;
  rev: string;
}

export interface SyncResponse {
  cursor: {
    decks: string;
    cards: string;
    testRuns: string;
    testRunQuestions: string;
  };
  decks: WireDeck[];
  cards: WireCard[];
  testRuns: WireTestRun[];
  testRunQuestions: WireTestRunQuestion[];
}
