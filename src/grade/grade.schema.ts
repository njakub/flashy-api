import { z } from 'zod';

// ---------------------------------------------------------------------------
// Wire protocol for POST /grade — sends a typed test-mode answer to Claude
// for a correct/incorrect verdict. This is a hand-maintained mirror of the
// client's src/lib/grading/wire.ts, same convention as sync.schema.ts.
// ---------------------------------------------------------------------------

export const localSignalSchema = z.object({
  outcome: z.enum(['correct', 'incorrect', 'ambiguous', 'error']),
  similarity: z.number().min(0).max(1).optional(),
});
export type LocalSignal = z.infer<typeof localSignalSchema>;

export const gradeRequestSchema = z.object({
  question: z.string().min(1),
  acceptedAnswers: z.array(z.string().min(1)).min(1),
  userAnswer: z.string(),
  // Present + non-empty only for concept cards (long-form interview-style
  // questions) — a rubric of things a complete answer should cover. Its
  // presence is what tells the service to switch to concept grading (see
  // grade.service.ts), mirroring the client's keyPoints.length > 0
  // "is this a concept card" convention (no separate discriminator).
  keyPoints: z.array(z.string().min(1)).max(20).optional(),
  // Set only when the client's embedding pre-filter escalated to the LLM
  // (the ambiguous band of the cascade) — captured on the usage row as a
  // (biased, escalation-only) quality signal. Absent when the user hit
  // "AI grade" directly.
  localSignal: localSignalSchema.optional(),
});
export type GradeRequest = z.infer<typeof gradeRequestSchema>;

export const gradeResponseSchema = z.object({
  outcome: z.enum(['correct', 'incorrect']),
  rationale: z.string(),
});
export type GradeResponse = z.infer<typeof gradeResponseSchema>;

export const keyPointCoverageSchema = z.object({
  point: z.string(),
  covered: z.boolean(),
});
export type KeyPointCoverage = z.infer<typeof keyPointCoverageSchema>;

// Only requested (via zodOutputFormat) when the request carries keyPoints —
// forces Claude to emit per-point coverage exactly when a rubric was given.
export const conceptGradeResponseSchema = gradeResponseSchema.extend({
  coverage: z.array(keyPointCoverageSchema),
});
export type ConceptGradeResponse = z.infer<typeof conceptGradeResponseSchema>;

// ---------------------------------------------------------------------------
// Wire protocol for POST /grade/feedback — the user's own final verdict,
// recorded after the fact against the LlmUsage row named by usageId (itself
// returned from POST /grade). This is the primary grading quality signal:
// unlike localSignal (only ever set on escalated calls, so it's biased
// toward the ambiguous band), userVerdict covers every AI-graded answer the
// user chose to correct.
// ---------------------------------------------------------------------------
export const gradeFeedbackRequestSchema = z.object({
  usageId: z.string().min(1),
  userVerdict: z.enum(['correct', 'incorrect']),
});
export type GradeFeedbackRequest = z.infer<typeof gradeFeedbackRequestSchema>;
