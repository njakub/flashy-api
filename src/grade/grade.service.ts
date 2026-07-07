import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  gradeResponseSchema,
  conceptGradeResponseSchema,
  type GradeRequest,
  type GradeResponse,
  type ConceptGradeResponse,
} from './grade.schema';

const MODEL = 'claude-haiku-4-5';

const SYSTEM_PROMPT = `You are grading a flashcard answer. You are given the question, the list of
accepted answers, and the student's answer. The student is correct if their answer matches the
meaning of any accepted answer — accept synonyms, paraphrases, minor spelling/case/word-order
differences, and partial answers that capture the key fact. Mark incorrect only if it is wrong,
empty, or misses the point. Reply with the structured result: "outcome" ("correct"/"incorrect")
and a one-sentence "rationale". Do not reveal chain-of-thought; the rationale is a brief
justification only.`;

// Concept cards are long-form interview-style questions ("Explain how the
// event loop works") graded against a rubric of key points rather than a
// short accepted-answer list — cosine-similarity-style exact matching
// doesn't apply here, so this prompt asks for point-by-point judgment
// instead of a single accepted-answer comparison.
const CONCEPT_SYSTEM_PROMPT = `You are grading a student's long-form answer to an interview-style
conceptual question. You are given the question, a rubric of key points a complete answer should
cover, and the student's answer. For each key point, judge from the answer's meaning whether it
was covered — accept paraphrases and out-of-order coverage, do not require the student's exact
wording. Set "outcome" to "correct" when the answer covers the essential key points (a student
need not restate every point verbatim, but a "correct" answer should be missing at most minor
points); set it to "incorrect" when major key points are missing or the answer is wrong/empty.
Reply with the structured result: "outcome", a one-sentence "rationale", and "coverage" — one
entry per key point (echo the point's exact text) with "covered" true/false. Do not reveal
chain-of-thought; the rationale is a brief justification only.`;

/**
 * Internal seam for a single-provider LLM grading call. Only AnthropicGrader
 * ships today; this interface is the swap point for a second provider, and
 * the boundary the future answer-improvement / card-generation prompts will
 * also sit behind. Concept-card grading (keyPoints present) widens the
 * return shape to ConceptGradeResponse rather than needing a second method —
 * callers (GradeController) just pass the response through untouched.
 */
export interface AiGrader {
  grade(input: GradeRequest): Promise<GradeResponse | ConceptGradeResponse>;
}

@Injectable()
export class AnthropicGrader implements AiGrader {
  private readonly logger = new Logger(AnthropicGrader.name);
  // No explicit apiKey — let the SDK resolve credentials itself (env var,
  // then an `ant auth login` profile). Passing an empty-string env value
  // here would shadow a working profile instead of falling through to it.
  private readonly client = new Anthropic();

  async grade(
    input: GradeRequest,
  ): Promise<GradeResponse | ConceptGradeResponse> {
    const isConcept = (input.keyPoints?.length ?? 0) > 0;

    const userTurnLines = [
      `Question: ${input.question}`,
      `Accepted answers: ${input.acceptedAnswers.join(' | ')}`,
      `Student's answer: ${input.userAnswer}`,
    ];
    if (isConcept) {
      userTurnLines.splice(
        1,
        0,
        `Key points a complete answer should cover:\n${input
          .keyPoints!.map((p, i) => `${i + 1}. ${p}`)
          .join('\n')}`,
      );
    }
    const userTurn = userTurnLines.join('\n');

    const response = await this.client.messages.parse({
      model: MODEL,
      max_tokens: isConcept ? 1024 : 256,
      system: isConcept ? CONCEPT_SYSTEM_PROMPT : SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userTurn }],
      output_config: {
        format: zodOutputFormat(
          isConcept ? conceptGradeResponseSchema : gradeResponseSchema,
        ),
      },
    });

    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      this.logger.warn(
        `AI grade did not resolve (stop_reason=${response.stop_reason})`,
      );
      throw new Error('AI grading failed to produce a verdict');
    }

    return response.parsed_output;
  }
}
