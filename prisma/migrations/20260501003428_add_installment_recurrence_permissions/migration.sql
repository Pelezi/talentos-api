-- AlterTable
ALTER TABLE "GroupRole" ADD COLUMN     "canManageInstallmentPlans" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canManageRecurrences" BOOLEAN NOT NULL DEFAULT false;
