import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MODELS } from '../llm/models';
import { buildDailySeries, computeTotals, summarizeByModel } from './aggregate';
import { computeRecommendations } from './recommendation';
import type { UsageRange } from './usage.schema';
import type { UsageRow } from './usage.types';

const RANGE_DAYS: Record<UsageRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};
const DAY_MS = 24 * 60 * 60 * 1000;
const RECOMMENDATION_WINDOW_DAYS = 30;

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(ownerId: string, range: UsageRange) {
    const from = new Date(Date.now() - RANGE_DAYS[range] * DAY_MS);
    const to = new Date();
    const rows = await this.fetchRows(ownerId, from);

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      totals: computeTotals(rows),
      byModel: summarizeByModel(rows),
      daily: buildDailySeries(rows),
    };
  }

  async recommendations(ownerId: string) {
    const from = new Date(Date.now() - RECOMMENDATION_WINDOW_DAYS * DAY_MS);
    const [rows, user] = await Promise.all([
      this.fetchRows(ownerId, from),
      this.prisma.user.findUnique({
        where: { id: ownerId },
        select: { gradingModel: true, generationModel: true },
      }),
    ]);
    if (!user) return { recommendations: [] };

    return {
      recommendations: computeRecommendations(
        rows,
        {
          gradingModel: user.gradingModel,
          generationModel: user.generationModel,
        },
        MODELS,
      ),
    };
  }

  private fetchRows(ownerId: string, from: Date): Promise<UsageRow[]> {
    return this.prisma.llmUsage.findMany({
      where: { ownerId, createdAt: { gte: from } },
      select: {
        task: true,
        provider: true,
        model: true,
        inputTokens: true,
        cachedInputTokens: true,
        outputTokens: true,
        costMicroUsd: true,
        latencyMs: true,
        success: true,
        llmOutcome: true,
        localOutcome: true,
        userOverride: true,
        isPdfSource: true,
        createdAt: true,
      },
    });
  }
}
