import { ApiProperty, PickType } from '@nestjs/swagger';
import { CategoryType } from '../../../generated/prisma/client';
import { SubcategoryData } from './subcategory.data';

export class SubcategoryInput extends PickType(SubcategoryData, ['name', 'categoryId'] as const) {
    @ApiProperty({ description: 'Subcategory description', required: false })
    public readonly description?: string;

    @ApiProperty({ description: 'Subcategory type - EXPENSE (0) or INCOME (1)', enum: ['EXPENSE', 'INCOME'], example: 'EXPENSE', required: false })
    public readonly type?: CategoryType;

    @ApiProperty({ description: 'Group ID', example: 1, required: false })
    public readonly groupId?: number;

    @ApiProperty({ description: 'Tithe percentage (default 10)', example: 10, required: false })
    public readonly tithePercentage?: number;

    @ApiProperty({ description: 'How many tithe transactions are generated (default 1)', example: 1, required: false })
    public readonly titheTransactionCount?: number;
}
