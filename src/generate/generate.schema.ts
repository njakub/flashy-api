import { z } from 'zod';

// ---------------------------------------------------------------------------
// Wire protocol for POST /generate — turns source material (pasted text or a
// PDF) into candidate flashcards for the user to review. Hand-maintained
// mirror of the client's src/lib/generate/wire.ts, same convention as
// grade.schema.ts / sync.schema.ts.
// ---------------------------------------------------------------------------

/** ~25–30K tokens — plenty for a long article without inviting whole books. */
export const MAX_SOURCE_TEXT_CHARS = 100_000;
/** ≈10 MB of raw PDF once base64-decoded (Anthropic's own cap is 32 MB/600 pages). */
export const MAX_PDF_BASE64_CHARS = 14_000_000;

export const generateRequestSchema = z.object({
  // Discriminated so a request is exactly one source kind — the service
  // switches between a text block and a native PDF document block on `type`.
  source: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('text'),
      text: z.string().min(1).max(MAX_SOURCE_TEXT_CHARS),
    }),
    z.object({
      type: z.literal('pdf'),
      // base64("%PDF-") — cheap magic-bytes check so an arbitrary file
      // renamed .pdf fails here with a clean 400 instead of upstream.
      data: z
        .string()
        .min(1)
        .max(MAX_PDF_BASE64_CHARS)
        .refine((s) => s.startsWith('JVBERi'), 'Not a PDF'),
    }),
  ]),
  // A target, not a contract — the model is told to prefer fewer, better
  // cards, and the service slices to this as a hard ceiling.
  targetCount: z.number().int().min(1).max(20),
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

// Structured-output schema (via zodOutputFormat) — deliberately free of
// min/max/length constraints, which structured outputs don't support.
// Count/emptiness rules are enforced by post-filtering in the service.
export const candidateCardSchema = z.object({
  front: z.string(),
  back: z.string(),
  alternateAnswers: z.array(z.string()),
  // Non-empty ⇒ concept card (same keyPoints.length > 0 convention the
  // client and grade.service.ts use — no separate discriminator field).
  keyPoints: z.array(z.string()),
  labels: z.array(z.string()),
});
export type CandidateCard = z.infer<typeof candidateCardSchema>;

export const generateResultSchema = z.object({
  cards: z.array(candidateCardSchema),
});
export type GenerateResult = z.infer<typeof generateResultSchema>;

// Wire response = the model's output shape, post-filtered by the service.
// An empty `cards` array is a legitimate 200 (thin source material).
export const generateResponseSchema = generateResultSchema;
export type GenerateResponse = z.infer<typeof generateResponseSchema>;
