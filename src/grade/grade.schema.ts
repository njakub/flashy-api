import { z } from 'zod';

// ---------------------------------------------------------------------------
// Wire protocol for POST /grade — sends a typed test-mode answer to Claude
// for a correct/incorrect verdict. This is a hand-maintained mirror of the
// client's src/lib/grading/wire.ts, same convention as sync.schema.ts.
// ---------------------------------------------------------------------------

export const gradeRequestSchema = z.object({
  question: z.string().min(1),
  acceptedAnswers: z.array(z.string().min(1)).min(1),
  userAnswer: z.string(),
});
export type GradeRequest = z.infer<typeof gradeRequestSchema>;

export const gradeResponseSchema = z.object({
  outcome: z.enum(['correct', 'incorrect']),
  rationale: z.string(),
});
export type GradeResponse = z.infer<typeof gradeResponseSchema>;
