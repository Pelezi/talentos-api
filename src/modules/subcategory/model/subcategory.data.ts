import { ApiProperty } from '@nestjs/swagger';
import { Subcategory, CategoryType } from '../../../generated/prisma/client';

export class SubcategoryData {

    @ApiProperty({ description: 'Subcategory unique ID', example: 1 })
    public readonly id: number;

    @ApiProperty({ description: 'User ID', example: 1 })
    public readonly userId: number;

    @ApiProperty({ description: 'Category ID', example: 1 })
    public readonly categoryId: number;

    @ApiProperty({ description: 'Subcategory name', example: 'Fresh Produce' })
    public readonly name: string;

    @ApiProperty({ description: 'Subcategory description', example: 'Fruits and vegetables', required: false })
    public readonly description?: string;

    @ApiProperty({ description: 'Subcategory type', enum: ['EXPENSE', 'INCOME'], example: 'EXPENSE' })
    public readonly type: CategoryType;

    @ApiProperty({ description: 'Whether the subcategory is hidden', example: false })
    public readonly hidden: boolean;

    @ApiProperty({ description: 'Whether this is the default fee subcategory', example: false })
    public readonly isDefaultFee: boolean;

    @ApiProperty({ description: 'Whether this is the default discount subcategory', example: false })
    public readonly isDefaultDiscount: boolean;

    @ApiProperty({ description: 'Whether this is the default tithe subcategory', example: false })
    public readonly isDefaultTithe: boolean;

    @ApiProperty({ description: 'Whether this subcategory participates in tithe calculation', example: false })
    public readonly isTitheParticipant: boolean;

    @ApiProperty({ description: 'Tithe percentage applied for automatic tithe generation', example: 10 })
    public readonly tithePercentage: number;

    @ApiProperty({ description: 'How many tithe transactions should be generated', example: 1 })
    public readonly titheTransactionCount: number;

    @ApiProperty({ description: 'Created at', example: '2024-01-01T00:00:00Z' })
    public readonly createdAt: Date;

    public constructor(entity: Subcategory) {
        this.id = entity.id;
        this.userId = entity.userId;
        this.categoryId = entity.categoryId;
        this.name = entity.name;
        this.description = entity.description || undefined;
        this.type = entity.type;
        this.hidden = entity.hidden;
        this.isDefaultFee = entity.isDefaultFee;
        this.isDefaultDiscount = entity.isDefaultDiscount;
        this.isDefaultTithe = (entity as any).isDefaultTithe ?? false;
        this.isTitheParticipant = (entity as any).isTitheParticipant ?? false;
        this.tithePercentage = Number((entity as any).tithePercentage ?? 10);
        this.titheTransactionCount = Number((entity as any).titheTransactionCount ?? 1);
        this.createdAt = entity.createdAt;
    }

}
