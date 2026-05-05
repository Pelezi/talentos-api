/*
  Warnings:

  - You are about to drop the column `defaultFeeSubcategoryId` on the `User` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_defaultFeeSubcategoryId_fkey";

-- AlterTable
ALTER TABLE "Subcategory" ADD COLUMN     "isDefaultDiscount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isDefaultFee" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "defaultFeeSubcategoryId";
