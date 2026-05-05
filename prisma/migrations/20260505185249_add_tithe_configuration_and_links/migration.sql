-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "isTitheParticipant" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Subcategory" ADD COLUMN     "isDefaultTithe" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isTitheParticipant" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "linkedTitheTransactionId" INTEGER;

-- CreateIndex
CREATE INDEX "Transaction_linkedTitheTransactionId_idx" ON "Transaction"("linkedTitheTransactionId");
