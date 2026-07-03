import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import type {
  Deck,
  Card,
  TestRun,
  TestRunQuestion,
} from '../generated/prisma/client';
import type {
  SyncRequest,
  PushDeck,
  PushCard,
  PushTestRun,
  PushTestRunQuestion,
} from './sync.schema';
import type {
  SyncResponse,
  WireDeck,
  WireCard,
  WireTestRun,
  WireTestRunQuestion,
} from './sync.types';

type Tx = Prisma.TransactionClient;
type SyncTable = 'Deck' | 'Card' | 'TestRun' | 'TestRunQuestion';

interface TouchedIds {
  decks: Set<string>;
  cards: Set<string>;
  testRuns: Set<string>;
  testRunQuestions: Set<string>;
}

/**
 * Push-then-pull delta sync. One call does both: incoming rows are
 * reconciled and written first, then everything changed since the client's
 * cursor (including the rows just written) is returned as the new pull.
 *
 * Conflict handling per table:
 *  - Deck: last-writer-wins on the whole row, by updatedAt.
 *  - Card: two independent field-groups — content (front/back/labels/...)
 *    reconciled by updatedAt, scheduling (SM-2 state) reconciled by
 *    lastReviewedAt — so a label edit on one device can never clobber a
 *    study review recorded on another, or vice versa.
 *  - TestRun / TestRunQuestion: append-only, create-if-absent, never
 *    content-updated. TestRun's only legal transition is null -> tombstoned
 *    (deck-delete cascade). TestRunQuestion has no ownerId/deletedAt of its
 *    own — ownership and lifecycle are scoped through the parent TestRun.
 */
@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  async sync(ownerId: string, req: SyncRequest): Promise<SyncResponse> {
    const touched: TouchedIds = {
      decks: new Set(),
      cards: new Set(),
      testRuns: new Set(),
      testRunQuestions: new Set(),
    };

    await this.prisma.$transaction(async (tx) => {
      for (const d of req.push.decks) {
        touched.decks.add(d.id);
        await this.applyDeck(tx, ownerId, d);
      }
      for (const c of req.push.cards) {
        touched.cards.add(c.id);
        await this.applyCard(tx, ownerId, c);
      }
      for (const r of req.push.testRuns) {
        touched.testRuns.add(r.id);
        await this.applyTestRun(tx, ownerId, r);
      }
      for (const q of req.push.testRunQuestions) {
        touched.testRunQuestions.add(q.id);
        await this.applyTestRunQuestion(tx, ownerId, q);
      }
    });

    const cursorIn = {
      decks: BigInt(req.cursor.decks),
      cards: BigInt(req.cursor.cards),
      testRuns: BigInt(req.cursor.testRuns),
      testRunQuestions: BigInt(req.cursor.testRunQuestions),
    };

    const [decks, cards, testRuns, testRunQuestions] = await Promise.all([
      this.pullSince(
        () =>
          this.prisma.deck.findMany({
            where: { ownerId, rev: { gt: cursorIn.decks } },
          }),
        touched.decks,
        (ids) =>
          this.prisma.deck.findMany({ where: { id: { in: ids }, ownerId } }),
      ),
      this.pullSince(
        () =>
          this.prisma.card.findMany({
            where: { ownerId, rev: { gt: cursorIn.cards } },
          }),
        touched.cards,
        (ids) =>
          this.prisma.card.findMany({ where: { id: { in: ids }, ownerId } }),
      ),
      this.pullSince(
        () =>
          this.prisma.testRun.findMany({
            where: { ownerId, rev: { gt: cursorIn.testRuns } },
          }),
        touched.testRuns,
        (ids) =>
          this.prisma.testRun.findMany({ where: { id: { in: ids }, ownerId } }),
      ),
      this.pullSince(
        () =>
          this.prisma.testRunQuestion.findMany({
            where: { run: { ownerId }, rev: { gt: cursorIn.testRunQuestions } },
          }),
        touched.testRunQuestions,
        (ids) =>
          this.prisma.testRunQuestion.findMany({
            where: { id: { in: ids }, run: { ownerId } },
          }),
      ),
    ]);

    return {
      cursor: {
        decks: (decks.maxRev ?? cursorIn.decks).toString(),
        cards: (cards.maxRev ?? cursorIn.cards).toString(),
        testRuns: (testRuns.maxRev ?? cursorIn.testRuns).toString(),
        testRunQuestions: (
          testRunQuestions.maxRev ?? cursorIn.testRunQuestions
        ).toString(),
      },
      decks: decks.rows.map(this.toWireDeck),
      cards: cards.rows.map(this.toWireCard),
      testRuns: testRuns.rows.map(this.toWireTestRun),
      testRunQuestions: testRunQuestions.rows.map(this.toWireTestRunQuestion),
    };
  }

  // ---------------------------------------------------------------------
  // Push — apply one incoming row per table
  // ---------------------------------------------------------------------

  private async applyDeck(tx: Tx, ownerId: string, d: PushDeck): Promise<void> {
    const existing = await tx.deck.findUnique({ where: { id: d.id } });
    if (existing && existing.ownerId !== ownerId) return;

    if (!existing) {
      const rev = await this.nextRev(tx, 'Deck');
      await tx.deck.create({
        data: {
          id: d.id,
          ownerId,
          name: d.name,
          createdAt: new Date(d.createdAt),
          updatedAt: new Date(d.updatedAt),
          deletedAt: d.deletedAt ? new Date(d.deletedAt) : null,
          rev,
        },
      });
      return;
    }

    const incomingUpdatedAt = new Date(d.updatedAt);
    if (incomingUpdatedAt.getTime() <= existing.updatedAt.getTime()) return;

    const wasDeleted = existing.deletedAt !== null;
    const nowDeleted = d.deletedAt !== null;
    const rev = await this.nextRev(tx, 'Deck');

    await tx.deck.update({
      where: { id: d.id },
      data: {
        name: d.name,
        updatedAt: incomingUpdatedAt,
        deletedAt: d.deletedAt ? new Date(d.deletedAt) : null,
        rev,
      },
    });

    // Defensive cascade — mirrors the client's own cascade (soft-delete of
    // its cards + test runs). Idempotent: only touches not-yet-deleted rows.
    if (!wasDeleted && nowDeleted) {
      await this.cascadeDeleteDeck(tx, d.id);
    }
  }

  private async applyCard(tx: Tx, ownerId: string, c: PushCard): Promise<void> {
    const existing = await tx.card.findUnique({ where: { id: c.id } });
    if (existing && existing.ownerId !== ownerId) return;

    const incomingUpdatedAt = new Date(c.updatedAt);
    const incomingLastReviewedAt = c.scheduling.lastReviewedAt
      ? new Date(c.scheduling.lastReviewedAt)
      : null;

    if (!existing) {
      const deck = await tx.deck.findUnique({ where: { id: c.deckId } });
      if (!deck || deck.ownerId !== ownerId) return;

      const rev = await this.nextRev(tx, 'Card');
      await tx.card.create({
        data: {
          id: c.id,
          ownerId,
          deckId: c.deckId,
          front: c.front,
          back: c.back,
          alternateAnswers: c.alternateAnswers,
          answerJustifications: c.answerJustifications ?? Prisma.JsonNull,
          labels: c.labels,
          createdAt: new Date(c.createdAt),
          updatedAt: incomingUpdatedAt,
          deletedAt: c.deletedAt ? new Date(c.deletedAt) : null,
          easeFactor: c.scheduling.easeFactor,
          intervalDays: c.scheduling.intervalDays,
          dueAt: new Date(c.scheduling.dueAt),
          reps: c.scheduling.reps,
          lapses: c.scheduling.lapses,
          lastReviewedAt: incomingLastReviewedAt,
          rev,
        },
      });
      return;
    }

    const contentWins =
      incomingUpdatedAt.getTime() > existing.updatedAt.getTime();
    const schedulingWins =
      existing.lastReviewedAt === null
        ? incomingLastReviewedAt !== null
        : incomingLastReviewedAt !== null &&
          incomingLastReviewedAt.getTime() > existing.lastReviewedAt.getTime();

    if (!contentWins && !schedulingWins) return; // fully stale — existing wins both groups

    const data: Prisma.CardUpdateInput = {};
    if (contentWins) {
      data.front = c.front;
      data.back = c.back;
      data.alternateAnswers = c.alternateAnswers;
      data.answerJustifications = c.answerJustifications ?? Prisma.JsonNull;
      data.labels = c.labels;
      data.updatedAt = incomingUpdatedAt;
      data.deletedAt = c.deletedAt ? new Date(c.deletedAt) : null;
    }
    if (schedulingWins) {
      data.easeFactor = c.scheduling.easeFactor;
      data.intervalDays = c.scheduling.intervalDays;
      data.dueAt = new Date(c.scheduling.dueAt);
      data.reps = c.scheduling.reps;
      data.lapses = c.scheduling.lapses;
      data.lastReviewedAt = incomingLastReviewedAt;
    }
    data.rev = await this.nextRev(tx, 'Card');

    await tx.card.update({ where: { id: c.id }, data });
  }

  private async applyTestRun(
    tx: Tx,
    ownerId: string,
    r: PushTestRun,
  ): Promise<void> {
    const existing = await tx.testRun.findUnique({ where: { id: r.id } });
    if (existing && existing.ownerId !== ownerId) return;

    if (!existing) {
      const deck = await tx.deck.findUnique({ where: { id: r.deckId } });
      if (!deck || deck.ownerId !== ownerId) return;

      const rev = await this.nextRev(tx, 'TestRun');
      await tx.testRun.create({
        data: {
          id: r.id,
          ownerId,
          deckId: r.deckId,
          startedAt: new Date(r.startedAt),
          completedAt: new Date(r.completedAt),
          questionCount: r.questionCount,
          correctCount: r.correctCount,
          deletedAt: r.deletedAt ? new Date(r.deletedAt) : null,
          rev,
        },
      });
      return;
    }

    // Append-only: the only legal change to an existing run is tombstoning.
    if (existing.deletedAt === null && r.deletedAt !== null) {
      const rev = await this.nextRev(tx, 'TestRun');
      await tx.testRun.update({
        where: { id: r.id },
        data: { deletedAt: new Date(r.deletedAt), rev },
      });
    }
  }

  private async applyTestRunQuestion(
    tx: Tx,
    ownerId: string,
    q: PushTestRunQuestion,
  ): Promise<void> {
    const existing = await tx.testRunQuestion.findUnique({
      where: { id: q.id },
    });
    if (existing) return; // immutable — idempotent no-op on retry

    const run = await tx.testRun.findUnique({ where: { id: q.runId } });
    if (!run || run.ownerId !== ownerId) return;

    const rev = await this.nextRev(tx, 'TestRunQuestion');
    await tx.testRunQuestion.create({
      data: {
        id: q.id,
        runId: q.runId,
        cardId: q.cardId,
        cardFrontSnapshot: q.cardFrontSnapshot,
        cardBackSnapshot: q.cardBackSnapshot,
        userAnswer: q.userAnswer,
        outcome: q.outcome === 'correct' ? 'CORRECT' : 'INCORRECT',
        similarity: q.similarity ?? null,
        rev,
      },
    });
  }

  /** Tombstones a deck's cards and test runs in bulk. One UPDATE per table. */
  private async cascadeDeleteDeck(tx: Tx, deckId: string): Promise<void> {
    const now = new Date();
    await tx.$executeRawUnsafe(
      `UPDATE "Card" SET "deletedAt" = $1, "rev" = nextval(pg_get_serial_sequence('"Card"', 'rev')) WHERE "deckId" = $2 AND "deletedAt" IS NULL`,
      now,
      deckId,
    );
    await tx.$executeRawUnsafe(
      `UPDATE "TestRun" SET "deletedAt" = $1, "rev" = nextval(pg_get_serial_sequence('"TestRun"', 'rev')) WHERE "deckId" = $2 AND "deletedAt" IS NULL`,
      now,
      deckId,
    );
  }

  /** table is always one of the four literal names above — never user input. */
  private async nextRev(tx: Tx, table: SyncTable): Promise<bigint> {
    const rows = await tx.$queryRawUnsafe<{ rev: string }[]>(
      `SELECT nextval(pg_get_serial_sequence('"${table}"', 'rev'))::text as rev`,
    );
    return BigInt(rows[0].rev);
  }

  // ---------------------------------------------------------------------
  // Pull — "changed since cursor" plus any row this call touched, even if
  // the push lost the conflict — so the client can always reconcile and
  // clear its dirty flag, never retry a stale write forever.
  // ---------------------------------------------------------------------

  private async pullSince<Row extends { id: string; rev: bigint }>(
    sinceQuery: () => Promise<Row[]>,
    touchedIds: Set<string>,
    fetchByIds: (ids: string[]) => Promise<Row[]>,
  ): Promise<{ rows: Row[]; maxRev: bigint | null }> {
    const sinceRows = await sinceQuery();
    const maxRev = sinceRows.reduce<bigint | null>(
      (max, r) => (max === null || r.rev > max ? r.rev : max),
      null,
    );

    const gotIds = new Set(sinceRows.map((r) => r.id));
    const missingIds = [...touchedIds].filter((id) => !gotIds.has(id));
    const extraRows = missingIds.length ? await fetchByIds(missingIds) : [];

    return { rows: [...sinceRows, ...extraRows], maxRev };
  }

  // ---------------------------------------------------------------------
  // Serialization — Prisma row -> wire shape (rev as string, dates as ISO)
  // ---------------------------------------------------------------------

  private toWireDeck(d: Deck): WireDeck {
    return {
      id: d.id,
      ownerId: d.ownerId,
      name: d.name,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      deletedAt: d.deletedAt ? d.deletedAt.toISOString() : null,
      rev: d.rev.toString(),
    };
  }

  private toWireCard(c: Card): WireCard {
    return {
      id: c.id,
      ownerId: c.ownerId,
      deckId: c.deckId,
      front: c.front,
      back: c.back,
      alternateAnswers: c.alternateAnswers,
      answerJustifications:
        (c.answerJustifications as Record<string, string> | null) ?? undefined,
      labels: c.labels,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
      rev: c.rev.toString(),
      scheduling: {
        easeFactor: c.easeFactor,
        intervalDays: c.intervalDays,
        dueAt: c.dueAt.toISOString(),
        reps: c.reps,
        lapses: c.lapses,
        lastReviewedAt: c.lastReviewedAt
          ? c.lastReviewedAt.toISOString()
          : null,
      },
    };
  }

  private toWireTestRun(r: TestRun): WireTestRun {
    return {
      id: r.id,
      ownerId: r.ownerId,
      deckId: r.deckId,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt.toISOString(),
      questionCount: r.questionCount,
      correctCount: r.correctCount,
      deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
      rev: r.rev.toString(),
    };
  }

  private toWireTestRunQuestion(q: TestRunQuestion): WireTestRunQuestion {
    return {
      id: q.id,
      runId: q.runId,
      cardId: q.cardId,
      cardFrontSnapshot: q.cardFrontSnapshot,
      cardBackSnapshot: q.cardBackSnapshot,
      userAnswer: q.userAnswer,
      outcome: q.outcome === 'CORRECT' ? 'correct' : 'incorrect',
      similarity: q.similarity ?? undefined,
      rev: q.rev.toString(),
    };
  }
}
