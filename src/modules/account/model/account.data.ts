import { ApiProperty } from '@nestjs/swagger';
import { Account, AccountType, BudgetMonthBasis, DebitMethod } from '../../../generated/prisma/client';

export class AccountData {

    @ApiProperty({ description: 'Account unique ID', example: 1 })
    public readonly id: number;

    @ApiProperty({ description: 'User ID', example: 1 })
    public readonly userId: number;

    @ApiProperty({ description: 'User', required: false })
    public readonly user?: {
        firstName: string;
        lastName: string;
    };

    @ApiProperty({ description: 'Group ID', example: 1, required: false })
    public readonly groupId?: number | null;

    @ApiProperty({ description: 'Account name', example: 'Dinheiro' })
    public readonly name: string;

    @ApiProperty({ description: 'Account type', enum: ['CREDIT', 'CASH', 'PREPAID'], example: 'CASH' })
    public readonly type: AccountType;

    @ApiProperty({ description: 'Subcategory ID (for PREPAID accounts)', example: 1, required: false })
    public readonly subcategoryId?: number;

    @ApiProperty({ description: 'Credit due day (1-31) for CREDIT accounts', example: 5, required: false })
    public readonly creditDueDay?: number;

    @ApiProperty({ description: 'Credit closing day (1-31) for CREDIT accounts', example: 25, required: false })
    public readonly creditClosingDay?: number;

    @ApiProperty({ description: 'Debit method for CREDIT accounts', enum: ['INVOICE','PER_PURCHASE'], required: false })
    public readonly debitMethod?: DebitMethod;

    @ApiProperty({ description: 'Budget month basis for CREDIT accounts with PER_PURCHASE debit', enum: ['PURCHASE_DATE','DUE_DATE'], required: false })
    public readonly budgetMonthBasis?: BudgetMonthBasis;

    @ApiProperty({ description: 'Automatically create invoices for CREDIT accounts', example: false })
    public readonly autoInvoice: boolean;

    @ApiProperty({ description: 'Is this the primary CASH account for invoice payments', example: false })
    public readonly isPrimary: boolean;

    @ApiProperty({ description: 'Created at', example: '2024-01-01T00:00:00Z' })
    public readonly createdAt: Date;

    @ApiProperty({ description: 'Updated at', example: '2024-01-01T00:00:00Z' })
    public readonly updatedAt: Date;

    public constructor(entity: Account & { user?: { firstName: string; lastName: string } | null }) {
        this.id = entity.id;
        this.userId = entity.userId;
        this.groupId = entity.groupId ?? undefined;
        this.name = entity.name;
        this.type = entity.type;
        this.createdAt = entity.createdAt;
        this.updatedAt = entity.updatedAt;
        this.user = entity.user ? {
            firstName: entity.user.firstName,
            lastName: entity.user.lastName
        } : undefined;
        this.subcategoryId = entity.subcategoryId ?? undefined;
        this.creditDueDay = entity.creditDueDay ?? undefined;
        this.creditClosingDay = entity.creditClosingDay ?? undefined;
        this.debitMethod = entity.debitMethod ?? undefined;
        this.budgetMonthBasis = entity.budgetMonthBasis ?? undefined;
        this.autoInvoice = (entity as any).autoInvoice ?? false;
        this.isPrimary = (entity as any).isPrimary ?? false;
    }

}
