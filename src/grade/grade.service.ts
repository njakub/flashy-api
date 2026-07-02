import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  gradeResponseSchema,
  type GradeRequest,
  type GradeResponse,
} from './grade.schema';

const MODEL = 'claude-haiku-4-5';

const SYSTEM_PROMPT = `You are grading a flashcard answer. You are given the question, the list of
accepted answers, and the student's answer. The student is correct if their answer matches the
meaning of any accepted answer — accept synonyms, paraphrases, minor spelling/case/word-order
differences, and partial answers that capture the key fact. Mark incorrect only if it is wrong,
empty, or misses the point. Reply with the structured result: "outcome" ("correct"/"incorrect")
and a one-sentence "rationale". Do not reveal chain-of-thought; the rationale is a brief
justification only.`;

/**
 * Internal seam for a single-provider LLM grading call. Only AnthropicGrader
 * ships today; this interface is the swap point for a second provider, and
 * the boundary the future answer-improvement / card-generation prompts will
 * also sit behind.
 */
export interface AiGrader {
  grade(input: GradeRequest): Promise<GradeResponse>;
}

@Injectable()
export class AnthropicGrader implements AiGrader {
  private readonly logger = new Logger(AnthropicGrader.name);
  // No explicit apiKey — let the SDK resolve credentials itself (env var,
  // then an `ant auth login` profile). Passing an empty-string env value
  // here would shadow a working profile instead of falling through to it.
  private readonly client = new Anthropic();

  async grade(input: GradeRequest): Promise<GradeResponse> {
    const userTurn = [
      `Question: ${input.question}`,
      `Accepted answers: ${input.acceptedAnswers.join(' | ')}`,
      `Student's answer: ${input.userAnswer}`,
    ].join('\n');

    const response = await this.client.messages.parse({
      model: MODEL,
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userTurn }],
      output_config: {
        format: zodOutputFormat(gradeResponseSchema),
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
