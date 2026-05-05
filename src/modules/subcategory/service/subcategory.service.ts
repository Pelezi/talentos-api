import { Injectable, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';

import { PrismaService } from '../../common';
import { SubcategoryData, SubcategoryInput } from '../model';

@Injectable()
export class SubcategoryService {

    public constructor(
        private readonly prismaService: PrismaService
    ) { }

    /**
     * Find all subcategories for a user
     *
     * @param userId User ID
     * @param categoryId Optional category filter
     * @param groupId Optional group filter
     * @param includeHidden Whether to include hidden subcategories (default: false)
     * @returns A subcategory list
     */
    public async findByUser(userId: number, categoryId?: number, groupId?: number, includeHidden: boolean = false): Promise<SubcategoryData[]> {

        const where: Prisma.SubcategoryWhereInput = {};

        // If groupId is provided, filter by group (accessible to all group members)
        // Otherwise, filter by userId AND groupId null (personal data only)
        if (groupId !== undefined) {
            where.groupId = groupId;
        } else {
            where.userId = userId;
            where.groupId = null;  // Ensure we only get personal subcategories, not group subcategories
        }

        if (categoryId) {
            where.categoryId = categoryId;
        }

        // Filter hidden subcategories unless explicitly requested
        if (!includeHidden) {
            where.hidden = false;
        }

        const subcategories = await this.prismaService.subcategory.findMany({
            where,
            orderBy: { name: 'asc' }
        });

        return subcategories.map(subcategory => new SubcategoryData(subcategory));
    }

    /**
     * Find a subcategory by ID
     *
     * @param id Subcategory ID
     * @param userId User ID
     * @returns A subcategory or null
     */
    public async findById(id: number, userId: number): Promise<SubcategoryData | null> {

        const subcategory = await this.prismaService.subcategory.findFirst({
            where: { id, userId }
        });

        if (!subcategory) {
            return null;
        }

        return new SubcategoryData(subcategory);
    }

    /**
     * Create a new subcategory
     *
     * @param userId User ID
     * @param data Subcategory details
     * @returns A subcategory created in the database
     */
    public async create(userId: number, data: SubcategoryInput): Promise<SubcategoryData> {

        const subcategory = await this.prismaService.subcategory.create({
            data: {
                userId,
                categoryId: data.categoryId,
                name: data.name,
                description: data.description,
                type: data.type,
                groupId: data.groupId
            }
        });

        return new SubcategoryData(subcategory);
    }

    /**
     * Update a subcategory
     *
     * @param id Subcategory ID
     * @param userId User ID
     * @param data Subcategory details
     * @returns Updated subcategory
     */
    public async update(id: number, userId: number, data: Partial<SubcategoryInput>): Promise<SubcategoryData> {

        const subcategory = await this.prismaService.subcategory.findFirst({
            where: { id, userId }
        });

        if (!subcategory) {
            throw new NotFoundException('Subcategory not found');
        }

        const updated = await this.prismaService.subcategory.update({
            where: { id },
            data
        });

        return new SubcategoryData(updated);
    }

    /**
     * Check if subcategory has associated transactions, budgets, or accounts
     *
     * @param id Subcategory ID
     * @param userId User ID
     * @returns Object with counts for transactions, budgets, and accounts
     */
    public async checkTransactions(id: number, userId: number): Promise<{
        hasTransactions: boolean;
        count: number;
        hasBudgets: boolean;
        budgetCount: number;
        hasAccounts: boolean;
        accountCount: number;
    }> {
        const subcategory = await this.prismaService.subcategory.findFirst({
            where: { id, userId }
        });

        if (!subcategory) {
            throw new NotFoundException('Subcategory not found');
        }

        // Count transactions
        const transactionCount = await this.prismaService.transaction.count({
            where: {
                subcategoryId: id
            }
        });

        // Count budgets
        const budgetCount = await this.prismaService.budget.count({
            where: {
                subcategoryId: id
            }
        });

        // Count accounts using this subcategory
        const accountCount = await this.prismaService.account.count({
            where: {
                subcategoryId: id
            }
        });

        return {
            hasTransactions: transactionCount > 0,
            count: transactionCount,
            hasBudgets: budgetCount > 0,
            budgetCount,
            hasAccounts: accountCount > 0,
            accountCount
        };
    }

    /**
     * Delete a subcategory
     *
     * @param id Subcategory ID
     * @param userId User ID
     * @param deleteTransactions If true, delete associated transactions
     * @param moveToSubcategoryId If provided and deleteTransactions is false, move transactions to this subcategory
     */
    public async delete(
        id: number,
        userId: number,
        deleteTransactions: boolean = false,
        moveToSubcategoryId?: number
    ): Promise<void> {

        try {

            const subcategory = await this.prismaService.subcategory.findFirst({
                where: { id, userId }
            });

            if (!subcategory) {
                throw new HttpException('Subcategoria não encontrada', HttpStatus.NOT_FOUND);
            }

            // Check if there are transactions
            const transactionCount = await this.prismaService.transaction.count({
                where: {
                    subcategoryId: id
                }
            });

            if (transactionCount > 0) {
                if (deleteTransactions) {
                    // Delete all transactions associated with this subcategory
                    await this.prismaService.transaction.deleteMany({
                        where: {
                            subcategoryId: id
                        }
                    });
                } else if (moveToSubcategoryId) {
                    // Verify target subcategory exists and belongs to user
                    const targetSubcategory = await this.prismaService.subcategory.findFirst({
                        where: { id: moveToSubcategoryId, userId }
                    });

                    if (!targetSubcategory) {
                        throw new HttpException('Subcategoria de destino não encontrada', HttpStatus.NOT_FOUND);
                    }

                    // Move all transactions to the target subcategory
                    await this.prismaService.transaction.updateMany({
                        where: {
                            subcategoryId: id
                        },
                        data: {
                            subcategoryId: moveToSubcategoryId
                        }
                    });

                } else {
                    throw new HttpException('Subcategoria possui transações. Por favor, especifique deleteTransactions=true ou forneça moveToSubcategoryId', HttpStatus.BAD_REQUEST);
                }
            }

            // Handle budgets
            if (deleteTransactions) {
                // Delete all budgets for this subcategory
                await this.prismaService.budget.deleteMany({
                    where: {
                        subcategoryId: id
                    }
                });
            } else if (moveToSubcategoryId) {
                // Transfer budgets to target subcategory, summing amounts for same month/year
                const budgetsToMove = await this.prismaService.budget.findMany({
                    where: {
                        subcategoryId: id
                    }
                });

                for (const budget of budgetsToMove) {
                    // Check if target already has a budget for this month/year
                    const existingBudget = await this.prismaService.budget.findFirst({
                        where: {
                            subcategoryId: moveToSubcategoryId,
                            month: budget.month,
                            year: budget.year
                        }
                    });

                    if (existingBudget) {
                        // Sum the amounts
                        await this.prismaService.budget.update({
                            where: { id: existingBudget.id },
                            data: {
                                amount: existingBudget.amount.toNumber() + budget.amount.toNumber()
                            }
                        });
                        // Delete the old budget
                        await this.prismaService.budget.delete({
                            where: { id: budget.id }
                        });
                    } else {
                        // Move the budget to target subcategory
                        await this.prismaService.budget.update({
                            where: { id: budget.id },
                            data: {
                                subcategoryId: moveToSubcategoryId
                            }
                        });
                    }
                }
            }

            // Handle accounts
            if (deleteTransactions) {
                // Set subcategoryId to null for accounts using this subcategory
                await this.prismaService.account.updateMany({
                    where: {
                        subcategoryId: id
                    },
                    data: {
                        subcategoryId: null
                    }
                });
            } else if (moveToSubcategoryId) {
                // Update accounts to use the target subcategory
                await this.prismaService.account.updateMany({
                    where: {
                        subcategoryId: id
                    },
                    data: {
                        subcategoryId: moveToSubcategoryId
                    }
                });
            }

            // Delete the subcategory
            await this.prismaService.subcategory.delete({
                where: { id }
            });

        } catch (error) {
            throw new HttpException(`Erro ao deletar subcategoria: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    /**
     * Hide a subcategory
     *
     * @param id Subcategory ID
     * @param userId User ID
     */
    public async hide(id: number, userId: number): Promise<SubcategoryData> {
        const subcategory = await this.prismaService.subcategory.findFirst({
            where: { id, userId }
        });

        if (!subcategory) {
            throw new NotFoundException('Subcategory not found');
        }

        const updated = await this.prismaService.subcategory.update({
            where: { id },
            data: { hidden: true }
        });

        return new SubcategoryData(updated);
    }

    /**
     * Unhide a subcategory
     *
     * @param id Subcategory ID
     * @param userId User ID
     */
    public async unhide(id: number, userId: number): Promise<SubcategoryData> {
        const subcategory = await this.prismaService.subcategory.findFirst({
            where: { id, userId }
        });

        if (!subcategory) {
            throw new NotFoundException('Subcategory not found');
        }

        const updated = await this.prismaService.subcategory.update({
            where: { id },
            data: { hidden: false }
        });

        return new SubcategoryData(updated);
    }

    /**
     * Set a subcategory as the default for automatic fee transactions (must be EXPENSE type)
     *
     * @param id Subcategory ID
     * @param userId User ID
     */
    public async setDefaultFeeSubcategory(id: number, userId: number): Promise<SubcategoryData> {
        const subcategory = await this.prismaService.subcategory.findFirst({
            where: { id, userId }
        });

        if (!subcategory) {
            throw new NotFoundException('Subcategory not found');
        }

        if (subcategory.type !== 'EXPENSE') {
            throw new HttpException('A subcategoria padrão de taxa precisa ser de despesa', HttpStatus.BAD_REQUEST);
        }

        await this.prismaService.$transaction([
            this.prismaService.subcategory.updateMany({
                where: { userId, groupId: subcategory.groupId ?? undefined, type: 'EXPENSE', isDefaultFee: true },
                data: { isDefaultFee: false }
            }),
            this.prismaService.subcategory.update({
                where: { id },
                data: { isDefaultFee: true }
            })
        ]);

        const result = await this.prismaService.subcategory.findUnique({ where: { id } });
        return new SubcategoryData(result!);
    }

    /**
     * Set a subcategory as the default for automatic discount transactions (must be INCOME type)
     *
     * @param id Subcategory ID
     * @param userId User ID
     */
    public async setDefaultDiscountSubcategory(id: number, userId: number): Promise<SubcategoryData> {
        const subcategory = await this.prismaService.subcategory.findFirst({
            where: { id, userId }
        });

        if (!subcategory) {
            throw new NotFoundException('Subcategory not found');
        }

        if (subcategory.type !== 'INCOME') {
            throw new HttpException('A subcategoria padrão de desconto precisa ser de renda', HttpStatus.BAD_REQUEST);
        }

        await this.prismaService.$transaction([
            this.prismaService.subcategory.updateMany({
                where: { userId, groupId: subcategory.groupId ?? undefined, type: 'INCOME', isDefaultDiscount: true },
                data: { isDefaultDiscount: false }
            }),
            this.prismaService.subcategory.update({
                where: { id },
                data: { isDefaultDiscount: true }
            })
        ]);

        const result = await this.prismaService.subcategory.findUnique({ where: { id } });
        return new SubcategoryData(result!);
    }

    public async clearDefaultFeeSubcategory(userId: number, groupId?: number): Promise<void> {
        await this.prismaService.subcategory.updateMany({
            where: {
                userId,
                groupId: groupId ?? null,
                type: 'EXPENSE',
                isDefaultFee: true,
            },
            data: { isDefaultFee: false } as any,
        });
    }

    public async clearDefaultDiscountSubcategory(userId: number, groupId?: number): Promise<void> {
        await this.prismaService.subcategory.updateMany({
            where: {
                userId,
                groupId: groupId ?? null,
                type: 'INCOME',
                isDefaultDiscount: true,
            },
            data: { isDefaultDiscount: false } as any,
        });
    }

    public async setDefaultTitheSubcategory(id: number, userId: number): Promise<SubcategoryData> {
        const subcategory = await this.prismaService.subcategory.findFirst({
            where: { id, userId }
        });

        if (!subcategory) {
            throw new NotFoundException('Subcategory not found');
        }

        if (subcategory.type !== 'EXPENSE') {
            throw new HttpException('A subcategoria padrão de dizimo precisa ser de despesa', HttpStatus.BAD_REQUEST);
        }

        await this.prismaService.$transaction([
            this.prismaService.subcategory.updateMany({
                where: { userId, groupId: subcategory.groupId ?? undefined, type: 'EXPENSE', isDefaultTithe: true } as any,
                data: { isDefaultTithe: false } as any
            }),
            this.prismaService.subcategory.update({
                where: { id },
                data: { isDefaultTithe: true } as any
            })
        ]);

        const result = await this.prismaService.subcategory.findUnique({ where: { id } });
        return new SubcategoryData(result!);
    }

    public async clearDefaultTitheSubcategory(userId: number, groupId?: number): Promise<void> {
        await this.prismaService.subcategory.updateMany({
            where: {
                userId,
                groupId: groupId ?? null,
                type: 'EXPENSE',
                isDefaultTithe: true,
            } as any,
            data: { isDefaultTithe: false } as any,
        });
    }

    public async setTitheParticipant(id: number, userId: number, enabled: boolean): Promise<SubcategoryData> {
        const subcategory = await this.prismaService.subcategory.findFirst({
            where: { id, userId }
        });

        if (!subcategory) {
            throw new NotFoundException('Subcategory not found');
        }

        if (subcategory.type !== 'INCOME') {
            throw new HttpException('A subcategoria participante de dizimo precisa ser de renda', HttpStatus.BAD_REQUEST);
        }

        const updated = await this.prismaService.subcategory.update({
            where: { id },
            data: { isTitheParticipant: enabled } as any
        });

        return new SubcategoryData(updated as any);
    }

}
