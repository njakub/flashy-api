-- AlterTable
ALTER TABLE "Deck" ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "Deck_parentId_idx" ON "Deck"("parentId");
