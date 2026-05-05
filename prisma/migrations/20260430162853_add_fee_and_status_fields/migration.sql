/*
  Warnings:

  - A unique constraint covering the columns `[feeTransactionId]` on the table `Transaction` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'CONFIRMED');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "feeAccountId" INTEGER,
ADD COLUMN     "feeAmount" DECIMAL(10,2),
ADD COLUMN     "feeTransactionId" INTEGER,
ADD COLUMN     "installmentPlanId" INTEGER,
ADD COLUMN     "linkedFeeTransactionId" INTEGER,
ADD COLUMN     "parentTransactionId" INTEGER,
ADD COLUMN     "recurrenceIndex" INTEGER,
ADD COLUMN     "recurrenceRuleId" INTEGER,
ADD COLUMN     "scheduledDate" TIMESTAMP(3),
ADD COLUMN     "status" "TransactionStatus" NOT NULL DEFAULT 'CONFIRMED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "defaultFeeSubcategoryId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_feeTransactionId_key" ON "Transaction"("feeTransactionId");

-- CreateIndex
CREATE INDEX "Transaction_feeAccountId_idx" ON "Transaction"("feeAccountId");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");

-- CreateIndex
CREATE INDEX "Transaction_scheduledDate_idx" ON "Transaction"("scheduledDate");

-- CreateIndex
CREATE INDEX "Transaction_feeTransactionId_idx" ON "Transaction"("feeTransactionId");

-- CreateIndex
CREATE INDEX "Transaction_linkedFeeTransactionId_idx" ON "Transaction"("linkedFeeTransactionId");

-- CreateIndex
CREATE INDEX "Transaction_parentTransactionId_idx" ON "Transaction"("parentTransactionId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_defaultFeeSubcategoryId_fkey" FOREIGN KEY ("defaultFeeSubcategoryId") REFERENCES "Subcategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_feeAccountId_fkey" FOREIGN KEY ("feeAccountId") REFERENCES "Account"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_feeTransactionId_fkey" FOREIGN KEY ("feeTransactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_parentTransactionId_fkey" FOREIGN KEY ("parentTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
