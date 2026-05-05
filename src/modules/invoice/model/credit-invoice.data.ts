import { ApiProperty } from '@nestjs/swagger';

export class CreditInvoiceData {

    @ApiProperty({ description: 'Invoice unique ID', example: 1 })
    public readonly id: number;

    @ApiProperty({ description: 'Credit card account ID', example: 5 })
    public readonly accountId: number;

    @ApiProperty({ description: 'User ID', example: 1 })
    public readonly userId: number;

    @ApiProperty({ description: 'Group ID', example: 1, required: false })
    public readonly groupId?: number | null;

    @ApiProperty({ description: 'Due month (1-12)', example: 6 })
    public readonly month: number;

    @ApiProperty({ description: 'Due year', example: 2025 })
    public readonly year: number;

    @ApiProperty({ description: 'Invoice due date', example: '2025-06-10T00:00:00Z' })
    public readonly dueDate: Date;

    @ApiProperty({ description: 'Total amount owed', example: 350.00 })
    public readonly totalAmount: number;

    @ApiProperty({ description: 'Invoice status', enum: ['OPEN', 'CLOSED', 'PAID'], example: 'OPEN' })
    public readonly status: string;

    @ApiProperty({ description: 'Pending transfer transaction ID (the fatura)', example: 42, required: false })
    public readonly transactionId?: number | null;

    @ApiProperty({ description: 'Created at', example: '2025-05-01T00:00:00Z' })
    public readonly createdAt: Date;

    @ApiProperty({ description: 'Updated at', example: '2025-05-01T00:00:00Z' })
    public readonly updatedAt: Date;

    public constructor(entity: any) {
        this.id = entity.id;
        this.accountId = entity.accountId;
        this.userId = entity.userId;
        this.groupId = entity.groupId ?? null;
        this.month = entity.month;
        this.year = entity.year;
        this.dueDate = entity.dueDate;
        this.totalAmount = Number(entity.totalAmount);
        this.status = entity.status;
        this.transactionId = entity.transactionId ?? null;
        this.createdAt = entity.createdAt;
        this.updatedAt = entity.updatedAt;
    }
}
