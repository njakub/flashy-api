-- CreateEnum
CREATE TYPE "GradingDefault" AS ENUM ('LOCAL', 'AI');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "gradingDefault" "GradingDefault" NOT NULL DEFAULT 'LOCAL';
