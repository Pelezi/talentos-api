import { ApiProperty } from '@nestjs/swagger';
import { CategoryType, TransactionStatus } from '../../../generated/prisma/client';

export class TransactionData {
    @ApiProperty({ description: 'Account ID', example: 1, required: true })
    public readonly accountId: number;

    @ApiProperty({ description: 'Transaction unique ID', example: 1 })
    public readonly id: number;

    @ApiProperty({ description: 'User ID', example: 1 })
    public readonly userId: number;

    @ApiProperty({ description: 'Subcategory ID', example: 1, required: false })
    public readonly subcategoryId?: number | null;

    @ApiProperty({ description: 'Transaction title', example: 'Grocery shopping' })
    public readonly title?: string | null;

    @ApiProperty({ description: 'Transaction amount', example: 50.00 })
    public readonly amount: number;

    @ApiProperty({ description: 'Transaction description', example: 'Weekly groceries at Whole Foods', required: false })
    public readonly description?: string | null;

    @ApiProperty({ description: 'Transaction date', example: '2024-01-15T00:00:00Z' })
    public readonly date: Date;

    @ApiProperty({ description: 'Transaction type', enum: ['EXPENSE', 'INCOME', 'TRANSFER', 'UPDATE'], example: 'EXPENSE' })
    public readonly type: CategoryType;

    @ApiProperty({ description: 'Destination account ID for transfers', example: 2, required: false })
    public readonly toAccountId?: number | null;

    @ApiProperty({ description: 'Created at', example: '2024-01-01T00:00:00Z' })
    public readonly createdAt: Date;

    @ApiProperty({ description: 'Updated at', example: '2024-01-01T00:00:00Z' })
    public readonly updatedAt: Date;

    // Fee fields
    @ApiProperty({ description: 'Fee amount', example: 50.00, required: false })
    public readonly feeAmount?: number | null;

    @ApiProperty({ description: 'Account where fee was debited', example: 2, required: false })
    public readonly feeAccountId?: number | null;

    @ApiProperty({ description: 'Linked fee transaction ID (if this transaction has a fee)', example: 101, required: false })
    public readonly feeTransactionId?: number | null;

    @ApiProperty({ description: 'If this transaction is a fee for another transaction', example: 100, required: false })
    public readonly linkedFeeTransactionId?: number | null;

    // Status fields
    @ApiProperty({ description: 'Transaction status', enum: ['PENDING', 'CONFIRMED'], example: 'CONFIRMED' })
    public readonly status: TransactionStatus;

    @ApiProperty({ description: 'Scheduled date (for pending transactions)', example: '2024-01-15T00:00:00Z', required: false })
    public readonly scheduledDate?: Date | null;

    @ApiProperty({ description: 'When transaction was confirmed', example: '2024-01-15T14:30:00Z', required: false })
    public readonly confirmedAt?: Date | null;

    @ApiProperty({ description: 'User information', required: false })
    public readonly user?: {
        id: number;
        firstName: string;
        lastName: string;
    };

    @ApiProperty({ description: 'Subcategory with category information', required: false })
    public readonly subcategory?: {
        id: number;
        name: string;
        category: {
            id: number;
            name: string;
            type: CategoryType;
        };
    } | null;

    @ApiProperty({ description: 'Account information', required: false })
    public readonly account?: {
        id: number;
        name: string;
        type: 'CREDIT' | 'CASH' | 'PREPAID';
    };

    @ApiProperty({ description: 'Fee account information (if different from main account)', required: false })
    public readonly feeAccount?: {
        id: number;
        name: string;
        type: 'CREDIT' | 'CASH' | 'PREPAID';
    } | null;

    @ApiProperty({ description: 'Fee transaction (if this has a fee)', required: false })
    public readonly feeTransaction?: TransactionData | null;

    @ApiProperty({ description: 'Installment plan ID (if part of installment plan)', example: 1, required: false })
    public readonly installmentPlanId?: number | null;

    @ApiProperty({ description: 'Recurrence rule ID (if part of recurrence)', example: 1, required: false })
    public readonly recurrenceRuleId?: number | null;

    @ApiProperty({ description: 'Index in recurrence (0-based)', example: 0, required: false })
    public readonly recurrenceIndex?: number | null;

    @ApiProperty({ description: 'Parent transaction ID (for installments)', example: 100, required: false })
    public readonly parentTransactionId?: number | null;

    public constructor(entity: any) {
        this.accountId = entity.accountId;
        this.id = entity.id;
        this.userId = entity.userId;
        this.subcategoryId = entity.subcategoryId;
        this.title = entity.title;
        this.amount = Number(entity.amount);
        this.description = entity.description;
        this.date = entity.date;
        this.type = entity.type;
        this.toAccountId = entity.toAccountId;
        this.createdAt = entity.createdAt;
        this.updatedAt = entity.updatedAt;

        // Fee fields
        this.feeAmount = entity.feeAmount ? Number(entity.feeAmount) : null;
        this.feeAccountId = entity.feeAccountId;
        this.feeTransactionId = entity.feeTransactionId;
        this.linkedFeeTransactionId = entity.linkedFeeTransactionId;

        // Status fields
        this.status = entity.status || 'CONFIRMED';
        this.scheduledDate = entity.scheduledDate;
        this.confirmedAt = entity.confirmedAt;
        
        // Include user data if available
        if (entity.user) {
            this.user = {
                id: entity.user.id,
                firstName: entity.user.firstName,
                lastName: entity.user.lastName
            };
        }

        // Include subcategory and category data if available
        if (entity.subcategory) {
            this.subcategory = {
                id: entity.subcategory.id,
                name: entity.subcategory.name,
                category: {
                    id: entity.subcategory.category.id,
                    name: entity.subcategory.category.name,
                    type: entity.subcategory.category.type
                }
            };
        }

        // Include account data if available
        if (entity.account) {
            this.account = {
                id: entity.account.id,
                name: entity.account.name,
                type: entity.account.type
            };
        }

        // Include fee account data if available
        if (entity.feeAccount) {
            this.feeAccount = {
                id: entity.feeAccount.id,
                name: entity.feeAccount.name,
                type: entity.feeAccount.type
            };
        }

        // Include fee transaction (avoid infinite recursion by not loading nested fee transactions)
        if (entity.feeTransaction && !entity.feeTransaction.feeTransaction) {
            this.feeTransaction = new TransactionData(entity.feeTransaction);
        }

        // Installment and recurrence fields
        this.installmentPlanId = entity.installmentPlanId;
        this.recurrenceRuleId = entity.recurrenceRuleId;
        this.recurrenceIndex = entity.recurrenceIndex;
        this.parentTransactionId = entity.parentTransactionId;
    }

}
