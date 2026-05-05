-- AlterTable
ALTER TABLE "Subcategory" ADD COLUMN     "tithePercentage" DECIMAL(5,2) NOT NULL DEFAULT 10.00,
ADD COLUMN     "titheTransactionCount" INTEGER NOT NULL DEFAULT 1;
