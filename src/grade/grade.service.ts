import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { resolveModelForTask } from '../llm/models';
import {
  gradeResponseSchema,
  conceptGradeResponseSchema,
  type GradeRequest,
  type GradeResponse,
  type ConceptGradeResponse,
} from './grade.schema';

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

export type GradeResult = (GradeResponse | ConceptGradeResponse) & {
  usageId: string;
};

@Injectable()
export class GradeService {
  private readonly logger = new Logger(GradeService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly prisma: PrismaService,
  ) {}

  async grade(ownerId: string, input: GradeRequest): Promise<GradeResult> {
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

    const user = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { gradingModel: true },
    });
    const model = resolveModelForTask(user?.gradingModel, 'grading');

    this.logger.debug(`Grading via ${model.id} for ${ownerId}`);

    const { output, usageId } = await this.llm.run({
      ownerId,
      task: 'grading',
      model,
      localSignal: input.localSignal,
      request: {
        system: isConcept ? CONCEPT_SYSTEM_PROMPT : SYSTEM_PROMPT,
        user: { text: userTurn },
        schema: isConcept ? conceptGradeResponseSchema : gradeResponseSchema,
        schemaName: 'grade_result',
        maxOutputTokens: isConcept ? 1024 : 256,
        reasoning: 'none',
      },
    });

    return { ...output, usageId };
  }
}
