import { ApiProperty } from '@nestjs/swagger';
import { AccountType, BudgetMonthBasis, DebitMethod } from '../../../generated/prisma/client';

export class AccountInput {
    @ApiProperty({ description: 'Account name', example: 'Dinheiro' })
    public readonly name: string;

    @ApiProperty({ description: 'Account type', enum: ['CREDIT', 'CASH', 'PREPAID'], example: 'CASH' })
    public readonly type: AccountType;

    @ApiProperty({ description: 'Group ID', example: 1, required: false })
    public readonly groupId?: number;

    @ApiProperty({ description: 'Initial balance', example: 0.00, required: false })
    public readonly initialBalance?: number;

    @ApiProperty({ description: 'User ID', example: 1, required: false })
    public readonly userId?: number;

    @ApiProperty({ description: 'Subcategory ID (used for PREPAID accounts)', example: 1, required: false })
    public readonly subcategoryId?: number;

    @ApiProperty({ description: 'Credit due day (1-31) for CREDIT accounts', example: 5, required: false })
    public readonly creditDueDay?: number;

    @ApiProperty({ description: 'Credit closing day (1-31) for CREDIT accounts', example: 25, required: false })
    public readonly creditClosingDay?: number;

    @ApiProperty({ description: 'Debit method for CREDIT accounts', enum: ['INVOICE','PER_PURCHASE'], example: 'INVOICE', required: false })
    public readonly debitMethod?: DebitMethod;

    @ApiProperty({ description: 'Budget month basis for CREDIT accounts with PER_PURCHASE debit', enum: ['PURCHASE_DATE','DUE_DATE'], example: 'PURCHASE_DATE', required: false })
    public readonly budgetMonthBasis?: BudgetMonthBasis;

    @ApiProperty({ description: 'Automatically create invoices for CREDIT accounts', example: false, required: false })
    public readonly autoInvoice?: boolean;

    @ApiProperty({ description: 'Is this the primary CASH account for invoice payments', example: false, required: false })
    public readonly isPrimary?: boolean;
}
