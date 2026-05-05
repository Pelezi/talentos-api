-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'CLOSED', 'PAID');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "autoInvoice" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CreditInvoice" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "groupId" INTEGER,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "transactionId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditInvoice_transactionId_key" ON "CreditInvoice"("transactionId");

-- CreateIndex
CREATE INDEX "CreditInvoice_accountId_idx" ON "CreditInvoice"("accountId");

-- CreateIndex
CREATE INDEX "CreditInvoice_userId_idx" ON "CreditInvoice"("userId");

-- CreateIndex
CREATE INDEX "CreditInvoice_groupId_idx" ON "CreditInvoice"("groupId");

-- CreateIndex
CREATE INDEX "CreditInvoice_status_idx" ON "CreditInvoice"("status");

-- CreateIndex
CREATE INDEX "CreditInvoice_dueDate_idx" ON "CreditInvoice"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "CreditInvoice_accountId_month_year_key" ON "CreditInvoice"("accountId", "month", "year");

-- AddForeignKey
ALTER TABLE "CreditInvoice" ADD CONSTRAINT "CreditInvoice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditInvoice" ADD CONSTRAINT "CreditInvoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditInvoice" ADD CONSTRAINT "CreditInvoice_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditInvoice" ADD CONSTRAINT "CreditInvoice_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
