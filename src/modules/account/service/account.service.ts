import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';

import { PrismaService } from '../../common';
import { AccountData, AccountInput, AccountBalanceData, AccountBalanceInput } from '../model';

@Injectable()
export class AccountService {

    public constructor(
        private readonly prismaService: PrismaService
    ) { }

    /**
     * Check if user has permission to manage an account
     * 
     * @param userId User ID
     * @param account Account entity
     * @returns boolean
     */
    private async canManageAccount(userId: number, account: any): Promise<boolean> {
        // If it's a personal account, only the owner can manage
        if (!account.groupId) {
            return account.userId === userId;
        }

        // For group accounts, check permissions
        const member = await this.prismaService.groupMember.findFirst({
            where: {
                groupId: account.groupId,
                userId
            },
            include: {
                role: true
            }
        });

        if (!member) {
            return false;
        }

        // Can manage all group accounts or can manage own accounts (if owner)
        return member.role.canManageGroupAccounts ||
            (member.role.canManageOwnAccounts && account.userId === userId);
    }

    /**
     * Find all accounts for a user
     *
     * @param userId User ID
     * @param groupId Optional group filter
     * @returns An account list
     */
    public async findByUser(userId: number, groupId?: number): Promise<AccountData[]> {
        try {

            const where: Prisma.AccountWhereInput = {};

            // If groupId is provided, filter by group (accessible to all group members)
            // Otherwise, filter by userId AND groupId null (personal data only)
            if (groupId !== undefined) {
                where.groupId = groupId;
            } else {
                where.userId = userId;
                where.groupId = null;  // Ensure we only get personal accounts, not group accounts
            }

            const accounts = await this.prismaService.account.findMany({
                include: {
                    user: {
                        select: { firstName: true, lastName: true }
                    },
                },
                where,
                orderBy: [
                    { name: 'asc' }
                ]
            });

            return accounts.map(account => new AccountData(account));

        } catch (error) {
            throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    /**
     * Find an account by ID
     *
     * @param id Account ID
     * @param userId User ID
     * @returns An account or null
     */
    public async findById(id: number, userId: number): Promise<AccountData | null> {

        const account = await this.prismaService.account.findFirst({
            where: {
                id,
                OR: [
                    { userId },
                    { group: { members: { some: { userId } } } }
                ]
            }
        });

        if (!account) {
            return null;
        }

        return new AccountData(account);
    }

    /**
     * Get current balance for an account
     *
     * @param accountId Account ID
     * @param userId User ID
     * @returns The most recent balance or null
     */
    public async getCurrentBalance(accountId: number, userId: number): Promise<AccountBalanceData | null> {

        // Verify user has access to this account
        const account = await this.findById(accountId, userId);
        if (!account) {
            throw new HttpException('Account not found', HttpStatus.NOT_FOUND);
        }

        const lastBalance = await this.prismaService.accountBalance.findFirst({
            where: { accountId },
            orderBy: { date: 'desc' }
        });

        const baselineAmount = lastBalance ? Number(lastBalance.amount) : 0;
        const baselineDate = lastBalance ? lastBalance.date : new Date(0);

        // Build transaction filter: any tx that references this account (either as from or to)
        // Only include transactions up to today (exclude future/scheduled)
        const conditions: Prisma.TransactionWhereInput[] = [
            { 
                date: { 
                    gt: baselineDate,
                    lte: new Date()  // Exclude future transactions
                }
            },
            {
                OR: [
                    { accountId },
                    { toAccountId: accountId }
                ]
            }
        ];

        // Scope transactions to the same ownership as the account (group or personal)
        if (account.groupId !== undefined && account.groupId !== null) {
            conditions.push({ groupId: account.groupId });
        } else {
            conditions.push({ userId: account.userId, groupId: null });
        }

        const txWhere: Prisma.TransactionWhereInput = { AND: conditions };

        const transactions = await this.prismaService.transaction.findMany({
            where: txWhere,
            orderBy: { date: 'asc' }
        });

        // Apply transactions to the baseline
        let net = 0;
        let latestTxDate: Date | null = null;
        for (const t of transactions) {
            latestTxDate = t.date > (latestTxDate ?? new Date(0)) ? t.date : latestTxDate;
            if (t.type === 'INCOME') {
                // Income always increases the destination account (accountId)
                if (t.accountId === accountId) net += Number(t.amount);
            } else if (t.type === 'EXPENSE') {
                // Expense decreases the origin account
                if (t.accountId === accountId) net -= Number(t.amount);
            } else if (t.type === 'TRANSFER') {
                // Transfer: subtract from origin, add to destination
                if (t.accountId === accountId) net -= Number(t.amount);
                if (t.toAccountId === accountId) net += Number(t.amount);
            }
        }

        const currentAmount = baselineAmount + net;

        // Build a synthetic AccountBalance-like object and return the DTO
        const resultEntity: any = {
            id: lastBalance ? lastBalance.id : 0,
            accountId,
            amount: currentAmount,
            date: latestTxDate ?? (lastBalance ? lastBalance.date : new Date()),
            createdAt: lastBalance ? lastBalance.createdAt : new Date()
        };

        return new AccountBalanceData(resultEntity);
    }

    /**
     * Get balance history for an account
     *
     * @param accountId Account ID
     * @param userId User ID
     * @returns List of account balances
     */
    public async getBalanceHistory(accountId: number, userId: number): Promise<AccountBalanceData[]> {

        // Verify user has access to this account
        const account = await this.findById(accountId, userId);
        if (!account) {
            throw new HttpException('Account not found', HttpStatus.NOT_FOUND);
        }

        const balances = await this.prismaService.accountBalance.findMany({
            where: { accountId },
            orderBy: { date: 'desc' }
        });

        return balances.map(b => new AccountBalanceData(b));
    }

    /**
     * Create a new account
     *
     * @param userId User ID
     * @param data Account details
     * @returns An account created in the database
     */
    public async create(userId: number, data: AccountInput): Promise<AccountData> {

        // If groupId is provided, verify user is member of that group
        if (data.groupId) {
            const groupMember = await this.prismaService.groupMember.findFirst({
                where: {
                    groupId: data.groupId,
                    userId
                }
            });

            if (!groupMember) {
                throw new HttpException('Você não é membro deste grupo', HttpStatus.UNAUTHORIZED);
            }
        }

        // Validate credit card specific fields
        if (data.type === 'CREDIT') {
            if (data.creditClosingDay && (data.creditClosingDay < 1 || data.creditClosingDay > 31)) {
                throw new HttpException('Dia de fechamento deve estar entre 1 e 31', HttpStatus.BAD_REQUEST);
            }
            if (data.creditDueDay && (data.creditDueDay < 1 || data.creditDueDay > 31)) {
                throw new HttpException('Dia de vencimento deve estar entre 1 e 31', HttpStatus.BAD_REQUEST);
            }
            if (data.autoInvoice && (!data.creditClosingDay || !data.creditDueDay)) {
                throw new HttpException(
                    'Dia de fechamento e dia de vencimento são obrigatórios para ativar faturas automáticas',
                    HttpStatus.BAD_REQUEST,
                );
            }
        }

        const account = await this.prismaService.account.create({
            data: {
                userId: data.userId || userId,
                name: data.name,
                type: data.type,
                groupId: data.groupId,
                // optional fields (cast to any to avoid generated type mismatch until prisma client is regenerated)
                subcategoryId: data.subcategoryId,
                creditDueDay: data.creditDueDay,
                creditClosingDay: data.creditClosingDay,
                debitMethod: data.debitMethod,
                autoInvoice: data.autoInvoice ?? false,
                isPrimary: data.isPrimary && data.type === 'CASH' ? true : false,
            } as any
        });

        // If this is a primary CASH account, unset other CASH accounts in the same scope
        if (account.type === 'CASH' && (data.isPrimary ?? false)) {
            const ownershipScope = account.groupId ? { groupId: account.groupId } : { userId: account.userId, groupId: null };
            await this.prismaService.account.updateMany({
                where: {
                    ...ownershipScope,
                    type: 'CASH',
                    NOT: { id: account.id },
                },
                data: { isPrimary: false },
            });
        }

        // Create initial balance if provided
        if (data.initialBalance !== undefined) {
            await this.prismaService.accountBalance.create({
                data: {
                    accountId: account.id,
                    amount: data.initialBalance,
                    date: new Date()
                }
            });
        }

        return new AccountData(account);
    }

    /**
     * Update an account
     *
     * @param id Account ID
     * @param userId User ID
     * @param data Account details
     * @returns An updated account
     */
    public async update(id: number, userId: number, data: Partial<AccountInput>): Promise<AccountData> {

        const existingAccount = await this.prismaService.account.findFirst({
            where: {
                id,
                OR: [
                    { userId },
                    { group: { members: { some: { userId } } } }
                ]
            }
        });

        if (!existingAccount) {
            throw new HttpException('Account not found', HttpStatus.NOT_FOUND);
        }

        // Check if user has permission to manage this account
        const canManage = await this.canManageAccount(userId, existingAccount);
        if (!canManage) {
            throw new HttpException('You do not have permission to manage this account', HttpStatus.UNAUTHORIZED);
        }

        // If groupId is being changed, verify user is member of new group
        if (data.groupId !== undefined && data.groupId !== existingAccount.groupId) {
            const groupMember = await this.prismaService.groupMember.findFirst({
                where: {
                    groupId: data.groupId,
                    userId
                }
            });

            if (!groupMember) {
                throw new HttpException('You are not a member of this group', HttpStatus.UNAUTHORIZED);
            }
        }

        // Validate credit card specific fields
        if (data.type === 'CREDIT' || existingAccount.type === 'CREDIT') {
            if (data.creditClosingDay && (data.creditClosingDay < 1 || data.creditClosingDay > 31)) {
                throw new HttpException('Dia de fechamento deve estar entre 1 e 31', HttpStatus.BAD_REQUEST);
            }
            if (data.creditDueDay && (data.creditDueDay < 1 || data.creditDueDay > 31)) {
                throw new HttpException('Dia de vencimento deve estar entre 1 e 31', HttpStatus.BAD_REQUEST);
            }
            // If enabling autoInvoice, ensure closing and due days are set
            const newAutoInvoice = data.autoInvoice ?? (existingAccount as any).autoInvoice;
            const effectiveClosingDay = data.creditClosingDay ?? (existingAccount as any).creditClosingDay;
            const effectiveDueDay = data.creditDueDay ?? (existingAccount as any).creditDueDay;
            if (newAutoInvoice && (!effectiveClosingDay || !effectiveDueDay)) {
                throw new HttpException(
                    'Dia de fechamento e dia de vencimento são obrigatórios para ativar faturas automáticas',
                    HttpStatus.BAD_REQUEST,
                );
            }
        }

        const updateData: Prisma.AccountUpdateInput = {};

        if (data.name !== undefined) updateData.name = data.name;
        if (data.type !== undefined) updateData.type = data.type;
        if (data.groupId !== undefined) {
            updateData.group = data.groupId
                ? { connect: { id: data.groupId } }
                : { disconnect: true };
        }
        if (data.subcategoryId !== undefined) {
            updateData.subcategory = (data.subcategoryId)
                ? { connect: { id: data.subcategoryId } }
                : { disconnect: true };
        }
        if (data.creditDueDay !== undefined) updateData.creditDueDay = data.creditDueDay;
        if (data.creditClosingDay !== undefined) updateData.creditClosingDay = data.creditClosingDay;
        if (data.debitMethod !== undefined) updateData.debitMethod = data.debitMethod;
        if (data.budgetMonthBasis !== undefined) updateData.budgetMonthBasis = data.budgetMonthBasis;
        if (data.autoInvoice !== undefined) (updateData as any).autoInvoice = data.autoInvoice;
        if (data.isPrimary !== undefined) (updateData as any).isPrimary = data.isPrimary && (data.type ?? existingAccount.type) === 'CASH' ? true : false;

        // If type is changing away from CREDIT, clear autoInvoice
        if (data.type && data.type !== 'CREDIT' && existingAccount.type === 'CREDIT') {
            (updateData as any).autoInvoice = false;
        }
        // If type is changing away from CASH, clear isPrimary
        if (data.type && data.type !== 'CASH' && existingAccount.type === 'CASH') {
            (updateData as any).isPrimary = false;
        }

        const account = await this.prismaService.account.update({
            where: { id },
            data: updateData
        });

        // If this is a primary CASH account, unset other CASH accounts in the same scope
        if (account.type === 'CASH' && (data.isPrimary ?? false)) {
            const ownershipScope = account.groupId ? { groupId: account.groupId } : { userId: account.userId, groupId: null };
            await this.prismaService.account.updateMany({
                where: {
                    ...ownershipScope,
                    type: 'CASH',
                    NOT: { id: account.id },
                },
                data: { isPrimary: false },
            });
        }

        return new AccountData(account);
    }

    /**
     * Delete an account
     *
     * @param id Account ID
     * @param userId User ID
     * @returns void
     */
    // NOTE: delete is implemented further below with an optional `force` flag

    /**
     * Count transactions referencing an account
     */
    public async countTransactions(accountId: number, userId: number): Promise<number> {
        const account = await this.findById(accountId, userId);
        if (!account) throw new HttpException('Account not found', HttpStatus.NOT_FOUND);

        // Build ownership constraint
        const ownershipConstraint: any = account.groupId !== undefined && account.groupId !== null
            ? { groupId: account.groupId }
            : { userId: account.userId, groupId: null };

        const count = await this.prismaService.transaction.count({
            where: {
                AND: [
                    {
                        OR: [
                            { accountId },
                            { toAccountId: accountId }
                        ]
                    },
                    ownershipConstraint
                ]
            }
        });

        return count;
    }

    /**
     * Move all transactions referencing accountId to targetAccountId
     */
    public async moveTransactions(accountId: number, targetAccountId: number, userId: number): Promise<{ movedOrigin: number; movedDestination: number }> {
        const source = await this.findById(accountId, userId);
        const target = await this.findById(targetAccountId, userId);

        if (!source || !target) throw new HttpException('Conta de origem ou destino não encontrada', HttpStatus.NOT_FOUND);

        // Ensure same ownership (same group or same personal owner)
        const sourceGroup = source.groupId ?? null;
        const targetGroup = target.groupId ?? null;

        if (sourceGroup !== targetGroup) {
            throw new HttpException('As contas devem pertencer ao mesmo grupo', HttpStatus.BAD_REQUEST);
        }

        // Permission checks
        if (sourceGroup !== null) {
            // Group accounts: verify user is member and has proper role permissions
            const member = await this.prismaService.groupMember.findFirst({
                where: { groupId: sourceGroup, userId },
                include: { role: true }
            });
            if (!member) {
                throw new HttpException('Você não é membro deste grupo', HttpStatus.UNAUTHORIZED);
            }

            // If can manage all group accounts, allow
            if (member.role.canManageGroupAccounts) {
                // allowed
            } else if (member.role.canManageOwnAccounts) {
                // can manage only own accounts: ensure both source and target belong to the user
                if (source.userId !== userId || target.userId !== userId) {
                    throw new HttpException('Você só pode mover transações entre suas próprias contas no grupo', HttpStatus.UNAUTHORIZED);
                }
            } else {
                throw new HttpException('Você não tem permissão para gerenciar contas deste grupo', HttpStatus.UNAUTHORIZED);
            }
        } else {
            // Personal accounts: user must be the owner of both accounts
            if (source.userId !== userId || target.userId !== userId) {
                throw new HttpException('Você não é o proprietário destas contas', HttpStatus.UNAUTHORIZED);
            }
        }

        // Ownership constraint
        const ownershipConstraint: any = source.groupId !== undefined && source.groupId !== null
            ? { groupId: source.groupId }
            : { userId: source.userId, groupId: null };

        const [movedOrigin, movedDestination] = await this.prismaService.$transaction([
            this.prismaService.transaction.updateMany({
                where: {
                    AND: [
                        { accountId },
                        ownershipConstraint
                    ]
                },
                data: { accountId: targetAccountId }
            }),
            this.prismaService.transaction.updateMany({
                where: {
                    AND: [
                        { toAccountId: accountId },
                        ownershipConstraint
                    ]
                },
                data: { toAccountId: targetAccountId }
            })
        ]);

        return { movedOrigin: movedOrigin.count, movedDestination: movedDestination.count };
    }

    /**
     * Delete account optionally forcing removal of related transactions and balances
     */
    public async delete(id: number, userId: number, options?: { force?: boolean }): Promise<void> {

        const account = await this.prismaService.account.findFirst({ where: { id } });
        if (!account) {
            throw new HttpException('Account not found', HttpStatus.NOT_FOUND);
        }

        // Check if user has permission to manage this account
        const canManage = await this.canManageAccount(userId, account);
        if (!canManage) {
            throw new HttpException('You do not have permission to manage this account', HttpStatus.UNAUTHORIZED);
        }

        const txCount = await this.countTransactions(id, userId);
        if (txCount > 0 && !options?.force) {
            // Signal to caller that there are transactions attached
            throw new HttpException('Account has linked transactions', HttpStatus.CONFLICT);
        }

        // Proceed with deletion inside a transaction: delete transactions, balances and the account
        const ownershipConstraint: any = account.groupId !== undefined && account.groupId !== null
            ? { groupId: account.groupId }
            : { userId: account.userId, groupId: null };

        await this.prismaService.$transaction([
            // delete transactions referencing this account
            this.prismaService.transaction.deleteMany({
                where: {
                    AND: [
                        {
                            OR: [
                                { accountId: id },
                                { toAccountId: id }
                            ]
                        },
                        ownershipConstraint
                    ]
                }
            }),
            // delete balances
            this.prismaService.accountBalance.deleteMany({ where: { accountId: id } }),
            // delete account
            this.prismaService.account.delete({ where: { id } })
        ]);
    }

    /**
     * Add a new balance entry for an account
     *
     * @param userId User ID
     * @param data Balance details
     * @returns A balance created in the database
     */
    public async addBalance(userId: number, data: AccountBalanceInput): Promise<AccountBalanceData> {

        // Verify user has access to this account
        const accountData = await this.findById(data.accountId, userId);
        if (!accountData) {
            throw new HttpException('Account not found', HttpStatus.NOT_FOUND);
        }

        // Get full account with relations to check permissions
        const account = await this.prismaService.account.findUnique({
            where: { id: data.accountId }
        });

        if (!account) {
            throw new HttpException('Account not found', HttpStatus.NOT_FOUND);
        }

        // Check if user has permission to manage this account
        const canManage = await this.canManageAccount(userId, account);
        if (!canManage) {
            throw new HttpException('You do not have permission to manage this account', HttpStatus.UNAUTHORIZED);
        }

        const balance = await this.prismaService.accountBalance.create({
            data: {
                accountId: data.accountId,
                amount: data.amount,
                date: data.date || new Date()
            }
        });
        return new AccountBalanceData(balance);
    }

    /**
     * Update a balance entry
     *
     * @param id Balance ID
     * @param userId User ID
     * @param data Balance details
     * @returns An updated balance
     */
    public async updateBalance(id: number, userId: number, data: Partial<AccountBalanceInput>): Promise<AccountBalanceData> {

        const existingBalance = await this.prismaService.accountBalance.findUnique({
            where: { id },
            include: { account: true }
        });

        if (!existingBalance) {
            throw new HttpException('Balance not found', HttpStatus.NOT_FOUND);
        }

        // Verify user has access to this account
        const accountData = await this.findById(existingBalance.accountId, userId);
        if (!accountData) {
            throw new HttpException('Account not found', HttpStatus.NOT_FOUND);
        }

        // Check if user has permission to manage this account
        const canManage = await this.canManageAccount(userId, existingBalance.account);
        if (!canManage) {
            throw new HttpException('You do not have permission to manage this account', HttpStatus.UNAUTHORIZED);
        }

        const updateData: Prisma.AccountBalanceUpdateInput = {};

        if (data.amount !== undefined) updateData.amount = data.amount;
        if (data.date !== undefined) updateData.date = data.date;

        const balance = await this.prismaService.accountBalance.update({
            where: { id },
            data: updateData
        });
        return new AccountBalanceData(balance);
    }

    /**
     * Get a single balance entry by id
     *
     * @param id Balance ID
     * @param userId User ID
     * @returns AccountBalanceData
     */
    public async getBalanceById(id: number, userId: number): Promise<AccountBalanceData> {
        const balance = await this.prismaService.accountBalance.findUnique({ where: { id }, include: { account: true } });
        if (!balance) {
            throw new HttpException('Balance not found', HttpStatus.NOT_FOUND);
        }

        // Verify user has access to this account (ownership or group membership)
        const accountData = await this.findById(balance.accountId, userId);
        if (!accountData) {
            throw new HttpException('Account not found', HttpStatus.NOT_FOUND);
        }

        return new AccountBalanceData(balance);
    }

    /**
     * Delete a balance entry
     *
     * @param id Balance ID
     * @param userId User ID
     * @returns void
     */
    public async deleteBalance(id: number, userId: number): Promise<void> {

        const balance = await this.prismaService.accountBalance.findUnique({
            where: { id },
            include: { account: true }
        });

        if (!balance) {
            throw new HttpException('Balance not found', HttpStatus.NOT_FOUND);
        }

        // Verify user has access to this account
        const accountData = await this.findById(balance.accountId, userId);
        if (!accountData) {
            throw new HttpException('Account not found', HttpStatus.NOT_FOUND);
        }

        // Check if user has permission to manage this account
        const canManage = await this.canManageAccount(userId, balance.account);
        if (!canManage) {
            throw new HttpException('You do not have permission to manage this account', HttpStatus.UNAUTHORIZED);
        }

        await this.prismaService.accountBalance.delete({
            where: { id }
        });
    }

    /**
     * Get the primary CASH account for a user or group
     * Used for auto-invoice configuration validation
     */
    public async getPrimaryCashAccount(userId: number, groupId?: number): Promise<AccountData | null> {
        if (groupId) {
            const groupMember = await this.prismaService.groupMember.findFirst({
                where: {
                    groupId,
                    userId,
                },
            });

            if (!groupMember) {
                throw new HttpException('Você não é membro deste grupo', HttpStatus.UNAUTHORIZED);
            }
        }

        const ownershipScope = groupId ? { groupId } : { userId, groupId: null };

        const account = await this.prismaService.account.findFirst({
            where: {
                ...ownershipScope,
                type: 'CASH',
                isPrimary: true,
            },
        });

        return account ? new AccountData(account) : null;
    }

}