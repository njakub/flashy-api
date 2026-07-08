-- CreateEnum
CREATE TYPE "LlmTask" AS ENUM ('GRADING', 'GENERATION');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "generationModel" TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
ADD COLUMN     "gradingModel" TEXT NOT NULL DEFAULT 'gemini-2.5-flash-lite';

-- CreateTable
CREATE TABLE "LlmUsage" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "task" "LlmTask" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorKind" TEXT,
    "llmOutcome" TEXT,
    "localOutcome" TEXT,
    "localSimilarity" DOUBLE PRECISION,
    "userOverride" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LlmUsage_ownerId_createdAt_idx" ON "LlmUsage"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "LlmUsage_ownerId_task_model_createdAt_idx" ON "LlmUsage"("ownerId", "task", "model", "createdAt");

-- AddForeignKey
ALTER TABLE "LlmUsage" ADD CONSTRAINT "LlmUsage_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
