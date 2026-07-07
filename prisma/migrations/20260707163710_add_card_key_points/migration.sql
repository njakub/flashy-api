-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "keyPoints" TEXT[] DEFAULT ARRAY[]::TEXT[];
