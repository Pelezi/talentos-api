import { Injectable, HttpException } from '@nestjs/common';
import { CategoryType, Prisma } from '../../../generated/prisma/client';

import { PrismaService } from '../../common';
import { AuditService } from '../../common/service/audit.service';
import { TransactionData, TransactionInput, TransactionAggregated } from '../model';

@Injectable()
export class TransactionService {

  public constructor(
    private readonly prismaService: PrismaService,
    private readonly auditService: AuditService
  ) { }

  /**
   * Calculate timezone offset in milliseconds for a given timezone and date
   * @param timezone IANA timezone string (e.g., 'America/Sao_Paulo')
   * @param date The date to calculate offset for
   * @returns Offset in milliseconds
   */
  private getTimezoneOffset(timezone: string, date: Date): number {
    try {
      // Get the date string in the target timezone
      const tzDateStr = date.toLocaleString('en-US', { timeZone: timezone });
      const tzDate = new Date(tzDateStr);
      // Get the date string in UTC
      const utcDateStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
      const utcDate = new Date(utcDateStr);
      // The difference is the offset
      return tzDate.getTime() - utcDate.getTime();
    } catch (error) {
      // If timezone is invalid, return 0 (treat as UTC)
      return 0;
    }
  }

  private async ensureTransactionAccess(transactionId: number, userId: number) {
    const transaction = await this.prismaService.transaction.findFirst({
      where: { id: transactionId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        subcategory: { include: { category: true } },
        account: true,
        feeAccount: true,
        feeTransaction: true,
        creditInvoice: true,
      },
    });

    if (!transaction) {
      throw new HttpException('Transação não encontrada', 404);
    }

    if (transaction.groupId) {
      const groupMember = await this.prismaService.groupMember.findFirst({
        where: {
          groupId: transaction.groupId,
          userId,
        },
      });

      if (!groupMember) {
        throw new HttpException('Transação não encontrada', 404);
      }
    } else if (transaction.userId !== userId) {
      throw new HttpException('Transação não encontrada', 404);
    }

    return transaction;
  }

  public async findByUser(
    userId: number,
    groupId?: number,
    categoryId?: number,
    subcategoryId?: number,
    accountId?: number,
    startDate?: Date,
    endDate?: Date,
    type?: CategoryType
  ): Promise<TransactionData[]> {

    const where: Prisma.TransactionWhereInput = {};

    // Only show confirmed transactions (exclude pending)
    where.status = 'CONFIRMED';

    if (groupId !== undefined) {
      where.groupId = groupId;
    } else {
      where.userId = userId;
      where.groupId = null;
    }

    if (categoryId) {
      const subcategories = await this.prismaService.subcategory.findMany({
        where: { categoryId }
      });
      const subcategoryIds = subcategories.map(s => s.id);
      if (subcategoryIds.length > 0) {
        where.subcategoryId = { in: subcategoryIds };
      } else {
        return [];
      }
    }

    if (subcategoryId) {
      where.subcategoryId = subcategoryId;
    }

    if (accountId) {
      where.OR = [
        { accountId },
        { toAccountId: accountId }
      ];
    }

    let adjustedStartDate: Date | undefined;
    let adjustedEndDate: Date | undefined;

    if (startDate || endDate) {
      // Fetch user's timezone to properly interpret date boundaries
      const user = await this.prismaService.user.findUnique({
        where: { id: userId },
        select: { timezone: true }
      });
      const userTimezone = user?.timezone || 'UTC';

      if (startDate) {
        // Convert start of day in user's timezone to UTC
        const startDateStr = startDate.toISOString().split('T')[0]; // YYYY-MM-DD
        const startInUserTz = new Date(`${startDateStr}T00:00:00`);
        // Calculate offset: parse as if it were in the user's timezone
        const offsetMs = this.getTimezoneOffset(userTimezone, startInUserTz);
        adjustedStartDate = new Date(startInUserTz.getTime() - offsetMs);
      }
      if (endDate) {
        // Convert end of day in user's timezone to UTC
        const endDateStr = endDate.toISOString().split('T')[0]; // YYYY-MM-DD
        const endInUserTz = new Date(`${endDateStr}T23:59:59.999`);
        const offsetMs = this.getTimezoneOffset(userTimezone, endInUserTz);
        adjustedEndDate = new Date(endInUserTz.getTime() - offsetMs);
      }

      where.date = {};
      if (adjustedStartDate) where.date.gte = adjustedStartDate;
      if (adjustedEndDate) where.date.lte = adjustedEndDate;
    }

    if (type) {
      where.type = type;
    }

    const transactions = await this.prismaService.transaction.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        subcategory: { include: { category: true } },
        account: true,
        feeAccount: true,
        feeTransaction: true,
      },
      orderBy: { date: 'desc' }
    });

    // Also fetch account balance updates in the same period and ownership scope
    const balanceWhere: any = {};
    if (adjustedStartDate || adjustedEndDate) {
      // Reuse the same timezone-adjusted date range from the main where clause
      balanceWhere.date = {};
      if (adjustedStartDate) balanceWhere.date.gte = adjustedStartDate;
      if (adjustedEndDate) balanceWhere.date.lte = adjustedEndDate;
    }

    // Account ownership constraint: if groupId provided, filter by account.groupId, otherwise by account.userId and account.groupId null
    if (groupId !== undefined) {
      balanceWhere.account = { groupId };
    } else {
      balanceWhere.account = { userId, groupId: null };
    }

    if (accountId) {
      balanceWhere.accountId = accountId;
    }

    const balances = await this.prismaService.accountBalance.findMany({
      where: balanceWhere,
      include: { account: true },
      orderBy: { date: 'desc' }
    });

    const syntheticFromBalances = balances.map(b => ({
      id: -(b.id),
      accountId: b.accountId,
      userId: b.account?.userId || userId,
      subcategoryId: null,
      title: 'Atualização de Saldo',
      amount: Number(b.amount),
      description: null,
      date: b.date,
      type: CategoryType.UPDATE,
      toAccountId: null,
      createdAt: b.createdAt,
    }));

    const combined = [...transactions, ...syntheticFromBalances];

    combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Convert combined raw entities to TransactionData DTOs (handles Decimal -> number)
  return combined.map(t => new TransactionData(t));
  }

  public async findById(id: number, userId: number): Promise<TransactionData> {
    try {
      const transaction = await this.ensureTransactionAccess(id, userId);
      return new TransactionData(transaction);
    } catch (error) {
      throw new HttpException(error.message, error.status || 500);
    }
  }

  public async create(userId: number, data: TransactionInput): Promise<TransactionData> {
    try {

      const resolvedUserId = data.userId || userId;

      if (data.groupId !== undefined && data.groupId !== null) {
        const groupMember = await this.prismaService.groupMember.findFirst({
          where: {
            groupId: data.groupId,
            userId,
          },
        });

        if (!groupMember) {
          throw new HttpException('Grupo não encontrado', 404);
        }

        if (data.userId && data.userId !== userId) {
          const targetMember = await this.prismaService.groupMember.findFirst({
            where: {
              groupId: data.groupId,
              userId: data.userId,
            },
          });

          if (!targetMember) {
            throw new HttpException('Usuário de destino não pertence ao grupo', 400);
          }
        }
      } else if (resolvedUserId !== userId) {
        throw new HttpException('Operação não permitida', 403);
      }

      const createData: any = {
        userId: resolvedUserId,
        groupId: data.groupId,
        subcategoryId: data.subcategoryId,
        accountId: data.accountId,
        // Frontend sometimes sends 0 when no account is selected — coerce 0 -> null so DB FK isn't violated
        toAccountId: data.toAccountId && Number(data.toAccountId) > 0 ? data.toAccountId : null,
        title: data.title,
        amount: data.amount,
        description: data.description,
        date: data.date + (data.time ? `T${data.time}Z` : 'T00:00:00Z'),
        type: data.type,
        status: data.status || 'CONFIRMED',
      };

      // Handle pending transactions
      if (data.status === 'PENDING') {
        // For pending transactions, scheduledDate is the same as date
        createData.scheduledDate = createData.date;
      } else {
        // For confirmed transactions, set confirmedAt to now
        createData.confirmedAt = new Date();
      }

      // Handle TRANSFER transactions: they should not reference a subcategory
      if (data.type === CategoryType.TRANSFER) {
        createData.subcategoryId = null;
        if (!data.toAccountId || Number(data.toAccountId) <= 0) {
          throw new HttpException('toAccountId is required for transfer transactions', 400);
        }
      } else {
        // If a subcategoryId was provided, validate it exists and belongs to the same user/group
        if (data.subcategoryId !== undefined && data.subcategoryId !== null) {
          const subcategory = await this.prismaService.subcategory.findUnique({ where: { id: data.subcategoryId } });
          if (!subcategory) {
            throw new HttpException('Subcategory not found', 400);
          }

          // If transaction is for a group, subcategory must belong to that group. Otherwise it must belong to the user.
          if (createData.groupId !== undefined && createData.groupId !== null) {
            if (subcategory.groupId !== createData.groupId) {
              throw new HttpException('Subcategory does not belong to this group', 400);
            }
          } else {
            if (subcategory.userId !== resolvedUserId) {
              throw new HttpException('Subcategory does not belong to this user', 400);
            }
          }
        }
      }

      const transaction = await this.prismaService.transaction.create({
        data: createData,
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          subcategory: { include: { category: true } },
          account: true
        }
      });

      // Handle fee transaction if feeAmount is provided
      let feeTransaction = null;
      if (data.feeAmount && data.feeAmount > 0) {
        const feeAccountId = data.feeAccountId || data.accountId;
        const status = data.status || 'CONFIRMED';
        
        // Create the fee transaction
        feeTransaction = await this.createFeeTransaction(
          resolvedUserId,
          data.groupId,
          feeAccountId,
          data.feeAmount,
          new Date(createData.date),
          status,
          transaction.id
        );

        // Update the main transaction to link to the fee transaction
        await this.prismaService.transaction.update({
          where: { id: transaction.id },
          data: {
            feeTransactionId: feeTransaction.id,
            feeAmount: new Prisma.Decimal(data.feeAmount),
            feeAccountId: feeAccountId
          }
        });

        // Reload transaction with updated data
        const updatedTransaction = await this.prismaService.transaction.findUnique({
          where: { id: transaction.id },
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
            subcategory: { include: { category: true } },
            account: true,
            feeAccount: true,
            feeTransaction: {
              include: {
                user: { select: { id: true, firstName: true, lastName: true } },
                subcategory: { include: { category: true } },
                account: true
              }
            }
          }
        });

        // Registrar auditoria
        await this.auditService.log({
          userId: resolvedUserId,
          groupId: data.groupId,
          entityType: 'Transaction',
          entityId: transaction.id,
          action: 'CREATE',
          changes: {
            amount: { before: null, after: data.amount },
            type: { before: null, after: data.type },
            subcategoryId: { before: null, after: data.subcategoryId },
            feeAmount: { before: null, after: data.feeAmount || null },
          },
          description: `Transação criada: ${data.type === 'EXPENSE' ? 'Despesa' : data.type === 'INCOME' ? 'Receita' : 'Transferência'} de R$ ${data.amount.toFixed(2)}`,
        });

        // Gerenciar fatura automática
        const involvedAccounts = [data.accountId];
        if (data.toAccountId && Number(data.toAccountId) > 0) involvedAccounts.push(Number(data.toAccountId));
        await this.applyAutoInvoiceDeltaForTransactionChange(
          null,
          updatedTransaction,
          resolvedUserId,
          data.groupId,
        );

        await this.createPendingTitheFromIncomeIfEligible({
          id: transaction.id,
          userId: resolvedUserId,
          groupId: data.groupId,
          subcategoryId: data.subcategoryId ?? null,
          accountId: data.accountId,
          amount: data.amount,
          date: new Date(createData.date),
          type: createData.type as CategoryType,
        });

        return new TransactionData(updatedTransaction);
      }

      // Registrar auditoria
      await this.auditService.log({
        userId: resolvedUserId,
        groupId: data.groupId,
        entityType: 'Transaction',
        entityId: transaction.id,
        action: 'CREATE',
        changes: {
          amount: { before: null, after: data.amount },
          type: { before: null, after: data.type },
          subcategoryId: { before: null, after: data.subcategoryId },
        },
        description: `Transação criada: ${data.type === 'EXPENSE' ? 'Despesa' : data.type === 'INCOME' ? 'Receita' : 'Transferência'} de R$ ${data.amount.toFixed(2)}`,
      });

      // Gerenciar fatura automática
      const involvedAccounts = [data.accountId];
      if (data.toAccountId && Number(data.toAccountId) > 0) involvedAccounts.push(Number(data.toAccountId));
      await this.applyAutoInvoiceDeltaForTransactionChange(
        null,
        transaction,
        resolvedUserId,
        data.groupId,
      );

      await this.createPendingTitheFromIncomeIfEligible({
        id: transaction.id,
        userId: resolvedUserId,
        groupId: data.groupId,
        subcategoryId: data.subcategoryId ?? null,
        accountId: data.accountId,
        amount: data.amount,
        date: new Date(createData.date),
        type: createData.type as CategoryType,
      });

      return new TransactionData(transaction);
    }
    catch (error) {
      throw new HttpException(error.message, error.status || 500);
    }
  }

  public async update(id: number, userId: number, data: Partial<TransactionInput>): Promise<TransactionData> {
    try {
      const transaction = await this.ensureTransactionAccess(id, userId);

      // 🔒 VALIDAÇÃO: Verificar se é uma transação de fatura
      const creditInvoice = await this.prismaService.creditInvoice.findFirst({
        where: { transactionId: id }
      });

      if (creditInvoice) {
        throw new HttpException(
          'Transações de fatura não podem ser editadas. Para fazer alterações, edite a fatura diretamente.',
          400
        );
      }

      // 🔒 VALIDAÇÃO: Verificar se faz parte de um plano de parcelamento
      if (transaction.installmentPlanId) {
        throw new HttpException(
          'Esta transação faz parte de um parcelamento e não pode ser editada individualmente. ' +
          'Para fazer alterações, edite o plano de parcelamento ou cancele-o.',
          400
        );
      }

      // 🔒 VALIDAÇÃO: Verificar se faz parte de uma regra de recorrência
      if (transaction.recurrenceRuleId) {
        throw new HttpException(
          'Esta transação faz parte de uma recorrência e não pode ser editada individualmente. ' +
          'Para fazer alterações, edite a regra de recorrência ou cancele-a.',
          400
        );
      }

      const updateData: any = { ...data };
      if (data.accountId !== undefined) {
        updateData.accountId = data.accountId;
      }
      if (data.toAccountId !== undefined) {
        // Coerce 0 -> null (frontend uses 0 as 'not selected')
        updateData.toAccountId = Number(data.toAccountId) > 0 ? data.toAccountId : null;
      }

      // Detectar mudanças para auditoria
      const changes = this.auditService.detectChanges(
        {
          amount: transaction.amount,
          type: transaction.type,
          subcategoryId: transaction.subcategoryId,
          accountId: transaction.accountId,
          feeAmount: transaction.feeAmount,
        },
        {
          amount: data.amount !== undefined ? data.amount : transaction.amount,
          type: data.type !== undefined ? data.type : transaction.type,
          subcategoryId: data.subcategoryId !== undefined ? data.subcategoryId : transaction.subcategoryId,
          accountId: data.accountId !== undefined ? data.accountId : transaction.accountId,
          feeAmount: data.feeAmount !== undefined ? data.feeAmount : transaction.feeAmount,
        },
        ['amount', 'type', 'subcategoryId', 'accountId', 'feeAmount']
      );

      // Combine date/time per payload:
      // - If date is provided: use it and (optional) time.
      // - If only time is provided: keep existing date and replace the time.
      if (data.date) {
        updateData.date = data.date + (data.time ? `T${data.time}Z` : 'T00:00:00Z');
        delete updateData.time;
      } else if (data.time) {
        const d = new Date(transaction.date);
        const yyyy = d.toISOString().slice(0, 10); // YYYY-MM-DD from existing
        updateData.date = `${yyyy}T${data.time}Z`;
        delete updateData.time;
      }

      await this.prismaService.transaction.update({
        where: { id },
        data: updateData,
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          subcategory: { include: { category: true } },
          account: true,
          feeAccount: true
        }
      });

      // Handle fee transaction updates
      if (data.feeAmount !== undefined) {
        if (data.feeAmount === null || data.feeAmount === 0) {
          // Remove fee transaction if exists
          if (transaction.feeTransactionId) {
            await this.deleteFeeTransaction(transaction.feeTransactionId);
            await this.prismaService.transaction.update({
              where: { id },
              data: {
                feeTransactionId: null,
                feeAmount: null,
                feeAccountId: null
              }
            });
          }
        } else {
          // Fee amount is provided
          const feeAccountId = data.feeAccountId !== undefined 
            ? data.feeAccountId 
            : (transaction.feeAccountId || transaction.accountId);
          
          const newDate = updateData.date ? new Date(updateData.date) : transaction.date;

          if (transaction.feeTransactionId) {
            // Update existing fee transaction
            await this.updateFeeTransaction(
              transaction.feeTransactionId,
              data.feeAmount,
              feeAccountId,
              newDate
            );

            // Update main transaction fee fields
            await this.prismaService.transaction.update({
              where: { id },
              data: {
                feeAmount: new Prisma.Decimal(data.feeAmount),
                feeAccountId: feeAccountId
              }
            });
          } else {
            // Create new fee transaction
            const status = data.status || transaction.status;
            const feeTransaction = await this.createFeeTransaction(
              transaction.userId,
              transaction.groupId,
              feeAccountId,
              data.feeAmount,
              newDate,
              status,
              transaction.id
            );

            // Update main transaction to link to fee
            await this.prismaService.transaction.update({
              where: { id },
              data: {
                feeTransactionId: feeTransaction.id,
                feeAmount: new Prisma.Decimal(data.feeAmount),
                feeAccountId: feeAccountId
              }
            });
          }
        }
      }

      // Reload transaction with all relations
      const finalTransaction = await this.prismaService.transaction.findUnique({
        where: { id },
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          subcategory: { include: { category: true } },
          account: true,
          feeAccount: true,
          feeTransaction: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true } },
              subcategory: { include: { category: true } },
              account: true
            }
          }
        }
      });

      // Registrar auditoria se houve mudanças
      if (changes && Object.keys(changes).length > 0) {
        await this.auditService.log({
          userId: transaction.userId,
          groupId: transaction.groupId ?? undefined,
          entityType: 'Transaction',
          entityId: id,
          action: 'UPDATE',
          changes,
          description: this.auditService.generateChangeDescription(
            'Transaction',
            'UPDATE',
            changes
          ),
        });
      }

      // Gerenciar fatura automática
      const updatedAccountId = data.accountId ?? transaction.accountId;
      const updatedToAccountId = data.toAccountId ?? transaction.toAccountId;
      const involvedUpdateAccounts = [updatedAccountId];
      if (transaction.accountId !== updatedAccountId) involvedUpdateAccounts.push(transaction.accountId);
      if (updatedToAccountId && Number(updatedToAccountId) > 0) involvedUpdateAccounts.push(Number(updatedToAccountId));
      if (transaction.toAccountId && Number(transaction.toAccountId) > 0) {
        involvedUpdateAccounts.push(Number(transaction.toAccountId));
      }
      await this.applyAutoInvoiceDeltaForTransactionChange(
        transaction,
        finalTransaction,
        transaction.userId,
        transaction.groupId,
      );

      // Se esta transação é o pagamento de uma fatura (PENDING → CONFIRMED),
      // sincronizar o status da fatura para PAID (apenas quando CLOSED)
      if (data.status === 'CONFIRMED' && transaction.status === 'PENDING') {
        const linkedInvoice = await (this.prismaService as any).creditInvoice.findFirst({
          where: { transactionId: id, status: 'CLOSED' },
          select: { id: true },
        });
        if (linkedInvoice) {
          await (this.prismaService as any).creditInvoice.update({
            where: { id: linkedInvoice.id },
            data: { status: 'PAID' },
          });
        }

        if (finalTransaction) {
          await this.createPendingTitheFromIncomeIfEligible({
            id: finalTransaction.id,
            userId: finalTransaction.userId,
            groupId: finalTransaction.groupId,
            subcategoryId: finalTransaction.subcategoryId,
            accountId: finalTransaction.accountId,
            amount: Number(finalTransaction.amount),
            date: finalTransaction.date,
            type: finalTransaction.type as CategoryType,
          });
        }
      }

      return new TransactionData(finalTransaction);
    } catch (error) {
      throw new HttpException(error.message, error.status || 500);
    }
  }

  public async delete(id: number, userId: number): Promise<void> {
    try {
      const transaction = await this.prismaService.transaction.findFirst({ 
        where: { id, userId },
        include: { feeTransaction: true }
      });
      
      if (!transaction) {
        const groupTransaction = await this.prismaService.transaction.findFirst({ 
          where: { 
            id,
            group: {
              members: {
                some: { userId }
              }
            }
          },
          include: { feeTransaction: true }
        });
        
        if (!groupTransaction) {
          throw new HttpException('Transaction not found', 404);
        }
        
        // Delete fee transaction if exists
        if (groupTransaction.feeTransactionId) {
          await this.deleteFeeTransaction(groupTransaction.feeTransactionId);
        }
        
        await this.prismaService.transaction.delete({ where: { id } });

        // Registrar auditoria
        await this.auditService.log({
          userId,
          groupId: groupTransaction.groupId ?? undefined,
          entityType: 'Transaction',
          entityId: id,
          action: 'DELETE',
          description: `Transação deletada: R$ ${groupTransaction.amount.toString()}`,
        });

        // Gerenciar fatura automática
        const delGroupAccounts = [groupTransaction.accountId];
        if (groupTransaction.toAccountId) delGroupAccounts.push(groupTransaction.toAccountId);
        await this.applyAutoInvoiceDeltaForTransactionChange(
          groupTransaction,
          null,
          userId,
          groupTransaction.groupId,
        );

        return;
      }
      
      // Delete fee transaction if exists
      if (transaction.feeTransactionId) {
        await this.deleteFeeTransaction(transaction.feeTransactionId);
      }
      
      await this.prismaService.transaction.delete({ where: { id } });

      // Registrar auditoria
      await this.auditService.log({
        userId,
        groupId: transaction.groupId ?? undefined,
        entityType: 'Transaction',
        entityId: id,
        action: 'DELETE',
        description: `Transação deletada: R$ ${transaction.amount.toString()}`,
      });

      // Gerenciar fatura automática
      const delAccounts = [transaction.accountId];
      if (transaction.toAccountId) delAccounts.push(transaction.toAccountId);
      await this.applyAutoInvoiceDeltaForTransactionChange(
        transaction,
        null,
        userId,
        transaction.groupId,
      );
    } catch (error) {
      throw new HttpException(error.message, error.status || 500);
    }
  }

  public async getAggregatedSpending(
    userId: number,
    startDate: Date,
    endDate: Date
  ): Promise<{ subcategoryId: number; total: number }[]> {

    try {

      const transactions = await this.prismaService.transaction.findMany({
        where: {
          userId,
          groupId: null,
          date: {
            gte: startDate,
            lte: endDate
          },
          type: { not: 'TRANSFER' }
        }
      });

      const map = new Map<number, number>();
      for (const t of transactions) {
        if (!t.subcategoryId) continue;
        const id = t.subcategoryId;
        map.set(id, (map.get(id) ?? 0) + Number(t.amount));
      }

      return Array.from(map.entries()).map(([subcategoryId, total]) => ({ subcategoryId, total }));

    } catch (error) {
      throw new HttpException(error.message, error.status || 500);
    }
  }

  /**
   * Calculate the due date month for a credit card transaction based on closing and due days
   * @param transactionDate The date of the transaction
   * @param closingDay The closing day of the credit card (1-31)
   * @param dueDay The due day of the credit card (1-31)
   * @returns Object with month (1-12) and year
   */
  private calculateDueDateMonth(transactionDate: Date, closingDay: number, dueDay: number): { month: number; year: number } {
    const txDate = new Date(transactionDate);
    const txMonth = txDate.getMonth(); // 0-11
    const txYear = txDate.getFullYear();
    const txDay = txDate.getDate();

    // Determine which billing cycle this transaction belongs to
    let billingMonth = txMonth;
    let billingYear = txYear;

    // If transaction is after closing day, it goes to next month's bill
    if (txDay > closingDay) {
      billingMonth += 1;
      if (billingMonth > 11) {
        billingMonth = 0;
        billingYear += 1;
      }
    }

    // Now calculate the due date for this billing cycle
    let dueMonth = billingMonth;
    let dueYear = billingYear;

    // Due date is typically in the next month after closing
    if (dueDay < closingDay) {
      dueMonth += 1;
      if (dueMonth > 11) {
        dueMonth = 0;
        dueYear += 1;
      }
    }

    return { month: dueMonth + 1, year: dueYear }; // Return 1-12 for month
  }

  public async getAggregatedByYear(
    userId: number,
    year: number,
    groupId?: number
  ): Promise<TransactionAggregated[]> {
    // Expand query range to include 2 months before the year to capture
    // transactions from previous year that may have due dates in the requested year
    // (e.g., December purchases with January due dates)
    const startDate = new Date(year - 1, 10, 1); // November of previous year
    const endDate = new Date(year + 1, 0, 1); // End of requested year

    const where: Prisma.TransactionWhereInput = { date: { gte: startDate, lt: endDate } };
    if (groupId !== undefined) {
      where.groupId = groupId;
    } else {
      where.userId = userId;
      where.groupId = null;
    }

    const transactions = await this.prismaService.transaction.findMany({ where });

    const accountWhere: any = {};
    if (groupId !== undefined) {
      accountWhere.groupId = groupId;
    } else {
      accountWhere.userId = userId;
      accountWhere.groupId = null;
    }
    const accounts = await this.prismaService.account.findMany({ where: accountWhere });
    const accountMap = new Map<number, { 
      type: string; 
      subcategoryId?: number | null; 
      debitMethod?: string | null; 
      budgetMonthBasis?: string | null;
      creditDueDay?: number | null;
      creditClosingDay?: number | null;
    }>();
    for (const account of accounts) {
      accountMap.set(account.id, { 
        type: account.type, 
        subcategoryId: account.subcategoryId, 
        debitMethod: account.debitMethod ?? null,
        budgetMonthBasis: account.budgetMonthBasis ?? null,
        creditDueDay: account.creditDueDay ?? null,
        creditClosingDay: account.creditClosingDay ?? null,
      });
    }

    const acc: Record<string, { subcategoryId: number; total: number; count: number; month: number; year: number; type: CategoryType }> = {};
    for (const t of transactions) {
      const d = new Date(t.date);

      // Non-transfer transactions: aggregate by their subcategory
      if (t.type !== 'TRANSFER') {
        // If this is an expense coming from a PREPAID account, skip it
        if (t.type === 'EXPENSE' && t.accountId) {
          const src = accountMap.get(t.accountId);
          if (src && src.type == 'PREPAID') {
            continue;
          }
          if (src && src.type == 'CREDIT' && src.debitMethod == 'INVOICE') {
            continue;
          }
        }

        if (!t.subcategoryId) continue;

        // Determine which month to attribute this transaction to
        let targetMonth = d.getMonth() + 1;
        let targetYear = d.getFullYear();

        // For CREDIT accounts with PER_PURCHASE debit and DUE_DATE basis, calculate due date month
        if (t.type === 'EXPENSE' && t.accountId) {
          const account = accountMap.get(t.accountId);
          if (account && 
              account.type === 'CREDIT' && 
              account.debitMethod === 'PER_PURCHASE' && 
              account.budgetMonthBasis === 'DUE_DATE' &&
              account.creditClosingDay &&
              account.creditClosingDay !== null &&
              account.creditDueDay &&
              account.creditDueDay !== null
              ) {
              const dueDateInfo = this.calculateDueDateMonth(d, account.creditClosingDay, account.creditDueDay);
              targetMonth = dueDateInfo.month;
              targetYear = dueDateInfo.year;
          }
        }

        const key = `${t.subcategoryId}-${targetMonth}-${targetYear}-${t.type}`;
        if (!acc[key]) {
          acc[key] = {
            subcategoryId: t.subcategoryId,
            total: 0,
            count: 0,
            month: targetMonth,
            year: targetYear,
            type: t.type,
          };
        }
        acc[key].total += Number(t.amount);
        acc[key].count += 1;
        continue;
      }

      // For TRANSFER transactions: if the destination account is a PREPAID account,
      // treat this transfer as an EXPENSE attributed to the prepaid account's configured subcategory.
      if (t.toAccountId) {
        const dest = accountMap.get(t.toAccountId);
        if (dest) {
          // Transfers to PREPAID accounts -> expense attributed to that account's subcategory
          if (dest.type === 'PREPAID' && dest.subcategoryId) {
            const subId = dest.subcategoryId as number;
            const key = `${subId}-${d.getMonth() + 1}-${d.getFullYear()}-EXPENSE`;
            if (!acc[key]) {
              acc[key] = {
                subcategoryId: subId,
                total: 0,
                count: 0,
                month: d.getMonth() + 1,
                year: d.getFullYear(),
                type: 'EXPENSE',
              };
            }
            acc[key].total += Number(t.amount);
            acc[key].count += 1;
          }

          // Transfers to CREDIT accounts with invoice billing -> treat as expense to the account's subcategory
          if (dest.type === 'CREDIT' && dest.subcategoryId) {
            const subId = dest.subcategoryId as number;
            const key = `${subId}-${d.getMonth() + 1}-${d.getFullYear()}-EXPENSE`;
            if (!acc[key]) {
              acc[key] = {
                subcategoryId: subId,
                total: 0,
                count: 0,
                month: d.getMonth() + 1,
                year: d.getFullYear(),
                type: 'EXPENSE',
              };
            }
            acc[key].total += Number(t.amount);
            acc[key].count += 1;
          }
        }
      }
    }

    return Object.values(acc)
      .filter(({ year: aggYear }) => aggYear === year)
      .map(({ subcategoryId, total, count, month, year, type }) =>
        new TransactionAggregated({ subcategoryId, total, count, month, year, type })
      );
  }

  /**
   * Find pending transactions for a user
   */
  public async findPendingByUser(
    userId: number,
    groupId?: number
  ): Promise<TransactionData[]> {
    const where: Prisma.TransactionWhereInput = {
      status: 'PENDING',
      linkedFeeTransactionId: null, // Exclude fee transactions
    };

    if (groupId !== undefined) {
      where.groupId = groupId;
    } else {
      where.userId = userId;
      where.groupId = null;
    }

    const transactions = await this.prismaService.transaction.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        subcategory: { include: { category: true } },
        account: true,
        feeAccount: true,
        feeTransaction: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
            subcategory: { include: { category: true } },
            account: true
          }
        },
        creditInvoice: true,
      },
      orderBy: { scheduledDate: 'asc' }
    });

    return transactions.map(t => new TransactionData(t));
  }

  /**
   * Confirm a pending transaction
   */
  public async confirmTransaction(id: number, userId: number): Promise<TransactionData> {
    try {
      // Find transaction and verify ownership
      const transaction = await this.prismaService.transaction.findFirst({
        where: { id },
      });

      if (!transaction) {
        throw new HttpException('Transaction not found', 404);
      }

      // Verify ownership (either user owns it or user is in group)
      if (transaction.groupId) {
        const groupMember = await this.prismaService.groupMember.findFirst({
          where: {
            groupId: transaction.groupId,
            userId
          }
        });
        if (!groupMember) {
          throw new HttpException('Transaction not found', 404);
        }
      } else if (transaction.userId !== userId) {
        throw new HttpException('Transaction not found', 404);
      }

      // Check if already confirmed
      if (transaction.status === 'CONFIRMED') {
        throw new HttpException('Transaction is already confirmed', 400);
      }

      // Update transaction to confirmed
      const now = new Date();
      const updatedTransaction = await this.prismaService.transaction.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          confirmedAt: now,
          date: now, // Move to current date/time
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          subcategory: { include: { category: true } },
          account: true,
          feeAccount: true,
          feeTransaction: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true } },
              subcategory: { include: { category: true } },
              account: true
            }
          }
        }
      });

      // Update fee transaction if exists
      if (transaction.feeTransactionId) {
        await this.prismaService.transaction.update({
          where: { id: transaction.feeTransactionId },
          data: {
            status: 'CONFIRMED',
            confirmedAt: now,
            date: now,
          }
        });
      }

      // If this transaction belongs to an installment plan, check if all installments are now confirmed
      if (transaction.installmentPlanId) {
        const remainingPending = await this.prismaService.transaction.count({
          where: {
            installmentPlanId: transaction.installmentPlanId,
            status: 'PENDING',
          },
        });

        if (remainingPending === 0) {
          await this.prismaService.installmentPlan.update({
            where: { id: transaction.installmentPlanId },
            data: { status: 'COMPLETED' },
          });
        }
      }

      // Recompute auto-invoice after this confirmation so OPEN invoices update totals
      // and rotate to a new pending transfer when needed.
      const involvedAccounts = [transaction.accountId];
      if (transaction.toAccountId && Number(transaction.toAccountId) > 0) {
        involvedAccounts.push(Number(transaction.toAccountId));
      }
      await this.applyAutoInvoiceDeltaForTransactionChange(
        transaction,
        updatedTransaction,
        transaction.userId,
        transaction.groupId,
      );

      // If this transaction is linked to a CLOSED invoice payment,
      // keep invoice status synchronized when confirming via pending screen endpoint.
      const linkedInvoice = await (this.prismaService as any).creditInvoice.findFirst({
        where: { transactionId: id, status: 'CLOSED' },
        select: { id: true },
      });
      if (linkedInvoice) {
        await (this.prismaService as any).creditInvoice.update({
          where: { id: linkedInvoice.id },
          data: { status: 'PAID' },
        });
      }

      await this.createPendingTitheFromIncomeIfEligible({
        id: updatedTransaction.id,
        userId: updatedTransaction.userId,
        groupId: updatedTransaction.groupId,
        subcategoryId: updatedTransaction.subcategoryId,
        accountId: updatedTransaction.accountId,
        amount: Number(updatedTransaction.amount),
        date: updatedTransaction.date,
        type: updatedTransaction.type,
      });

      return new TransactionData(updatedTransaction);
    } catch (error) {
      throw new HttpException(error.message, error.status || 500);
    }
  }

  /**
   * Private helper methods for fee transactions
   */

  /**
   * Create or get the default fee subcategory for a user
   * Creates "Taxas e Juros" subcategory under "Outras Despesas" category if not exists
   */
  private async createOrGetFeeSubcategory(userId: number, groupId?: number): Promise<number> {
    // Check if user already has a default fee subcategory via the isDefaultFee flag
    const existingDefault = await this.prismaService.subcategory.findFirst({
      where: {
        userId,
        groupId: groupId ?? null,
        isDefaultFee: true,
        type: CategoryType.EXPENSE
      }
    });

    if (existingDefault) {
      return existingDefault.id;
    }

    // Check if "Taxas e Juros" subcategory already exists (legacy, promote it to default)
    const existingSubcategory = await this.prismaService.subcategory.findFirst({
      where: {
        userId,
        groupId: groupId ?? null,
        name: 'Taxas e Juros',
        type: CategoryType.EXPENSE
      }
    });

    if (existingSubcategory) {
      await this.prismaService.subcategory.update({
        where: { id: existingSubcategory.id },
        data: { isDefaultFee: true }
      });
      return existingSubcategory.id;
    }

    // Find or create "Outras Despesas" category
    let defaultCategory = await this.prismaService.category.findFirst({
      where: {
        userId,
        groupId,
        name: 'Outras Despesas',
        type: CategoryType.EXPENSE
      }
    });

    if (!defaultCategory) {
      defaultCategory = await this.prismaService.category.create({
        data: {
          userId,
          groupId,
          name: 'Outras Despesas',
          type: CategoryType.EXPENSE,
          hidden: false
        }
      });
    }

    // Create "Taxas e Juros" subcategory and mark as default fee
    const newSubcategory = await this.prismaService.subcategory.create({
      data: {
        userId,
        groupId,
        categoryId: defaultCategory.id,
        name: 'Taxas e Juros',
        type: CategoryType.EXPENSE,
        hidden: false,
        isDefaultFee: true
      }
    });

    return newSubcategory.id;
  }

  /**
   * Create a fee transaction linked to the main transaction
   */
  private async createFeeTransaction(
    userId: number,
    groupId: number | undefined | null,
    feeAccountId: number,
    feeAmount: number,
    originalDate: Date,
    originalStatus: string,
    originalTransactionId: number
  ): Promise<any> {
    // Get the fee subcategory
    const feeSubcategoryId = await this.createOrGetFeeSubcategory(userId, groupId ?? undefined);

    // Create fee transaction
    const feeTransaction = await this.prismaService.transaction.create({
      data: {
        userId,
        groupId,
        accountId: feeAccountId,
        subcategoryId: feeSubcategoryId,
        amount: new Prisma.Decimal(feeAmount),
        description: `Taxa ref. transação #${originalTransactionId}`,
        date: originalDate,
        status: originalStatus as any,
        type: CategoryType.EXPENSE,
        linkedFeeTransactionId: originalTransactionId
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        subcategory: { include: { category: true } },
        account: true
      }
    });

    return feeTransaction;
  }

  private async createPendingTitheFromIncomeIfEligible(input: {
    id: number;
    userId: number;
    groupId?: number | null;
    subcategoryId?: number | null;
    accountId: number;
    amount: number;
    date: Date;
    type: CategoryType;
  }): Promise<void> {
    if (input.type !== CategoryType.INCOME) {
      return;
    }

    if (!input.subcategoryId) {
      return;
    }

    const existingTithe = await this.prismaService.transaction.findFirst({
      where: {
        linkedTitheTransactionId: input.id,
      } as any,
      select: { id: true },
    });

    if (existingTithe) {
      return;
    }

    const incomeSubcategory: any = await this.prismaService.subcategory.findFirst({
      where: {
        id: input.subcategoryId,
      },
      select: {
        id: true,
        categoryId: true,
        type: true,
        isTitheParticipant: true,
      } as any,
    });

    if (!incomeSubcategory || incomeSubcategory.type !== CategoryType.INCOME) {
      return;
    }

    const isParticipant = Boolean((incomeSubcategory as any).isTitheParticipant);

    if (!isParticipant) {
      return;
    }

    const titheSubcategory = await this.prismaService.subcategory.findFirst({
      where: {
        userId: input.userId,
        groupId: input.groupId ?? null,
        type: CategoryType.EXPENSE,
        isDefaultTithe: true,
      } as any,
      select: { id: true },
    });

    if (!titheSubcategory) {
      return;
    }

    const titheAmount = Math.round(input.amount * 0.1 * 100) / 100;
    if (titheAmount <= 0) {
      return;
    }

    await this.prismaService.transaction.create({
      data: {
        userId: input.userId,
        groupId: input.groupId ?? null,
        subcategoryId: titheSubcategory.id,
        accountId: input.accountId,
        amount: new Prisma.Decimal(titheAmount),
        description: `Dizimo pendente ref. transação #${input.id}`,
        date: input.date,
        scheduledDate: input.date,
        status: 'PENDING',
        type: CategoryType.EXPENSE,
        linkedTitheTransactionId: input.id,
      } as any,
    });
  }

  /**
   * Update an existing fee transaction
   */
  private async updateFeeTransaction(
    feeTransactionId: number,
    newFeeAmount?: number,
    newFeeAccountId?: number,
    newDate?: Date
  ): Promise<void> {
    const updateData: any = {};

    if (newFeeAmount !== undefined) {
      updateData.amount = new Prisma.Decimal(newFeeAmount);
    }

    if (newFeeAccountId !== undefined) {
      updateData.accountId = newFeeAccountId;
    }

    if (newDate !== undefined) {
      updateData.date = newDate;
    }

    if (Object.keys(updateData).length > 0) {
      await this.prismaService.transaction.update({
        where: { id: feeTransactionId },
        data: updateData
      });
    }
  }

  /**
   * Delete a fee transaction
   */
  private async deleteFeeTransaction(feeTransactionId: number): Promise<void> {
    await this.prismaService.transaction.delete({
      where: { id: feeTransactionId }
    });
  }

  // ─── Auto-invoice (fatura automática) ───────────────────────────────────────

  /**
   * Determine which billing cycle (month/year of the DUE DATE) a transaction belongs to.
   *
   * Rules:
    *  - EXPENSE / INCOME / TRANSFER FROM credit card → if txDay > closingDay, next cycle; else current cycle.
    *  - TRANSFER TO credit card  → always current cycle (even if closing passed).
   *
   * Returns { month (1-12), year, dueDate }.
   */
  private calculateInvoiceCycle(
    txDate: Date,
    txType: string,
    isCreditAccountSource: boolean, // accountId === creditAccountId
    closingDay: number,
    dueDay: number,
  ): { month: number; year: number; dueDate: Date } {
    const d = new Date(txDate);
    const txDay = d.getUTCDate();
    const txMonth = d.getUTCMonth(); // 0-11
    const txYear = d.getUTCFullYear();

    // Determine billing month (0-indexed) based on whether the transaction shifts to next cycle
    let billingMonth = txMonth;
    let billingYear = txYear;

    const shiftsToNextCycle =
      (txType === 'EXPENSE' && isCreditAccountSource) ||
      (txType === 'INCOME' && isCreditAccountSource) ||
      (txType === 'TRANSFER' && isCreditAccountSource);

    if (shiftsToNextCycle && txDay > closingDay) {
      billingMonth += 1;
      if (billingMonth > 11) {
        billingMonth = 0;
        billingYear += 1;
      }
    }

    // The DUE DATE is in the "billing month" if dueDay >= closingDay,
    // or in the NEXT month if dueDay < closingDay (due is after the closing of the next month).
    let dueMonth = billingMonth;
    let dueYear = billingYear;
    if (dueDay < closingDay) {
      dueMonth += 1;
      if (dueMonth > 11) {
        dueMonth = 0;
        dueYear += 1;
      }
    }

    // Build the actual due date (use last day of month if dueDay exceeds month length)
    const maxDay = new Date(dueYear, dueMonth + 1, 0).getDate();
    const clampedDueDay = Math.min(dueDay, maxDay);
    const dueDate = new Date(Date.UTC(dueYear, dueMonth, clampedDueDay));

    return { month: dueMonth + 1, year: dueYear, dueDate };
  }

  /**
   * Find or create a CreditInvoice record for a given account + billing cycle.
   */
  private async findOrCreateCreditInvoice(
    accountId: number,
    userId: number,
    groupId: number | null | undefined,
    month: number,
    year: number,
    dueDate: Date,
  ): Promise<any> {
    // Use upsert to avoid race conditions when two transactions land simultaneously
    return (this.prismaService as any).creditInvoice.upsert({
      where: { accountId_month_year: { accountId, month, year } },
      create: {
        accountId,
        userId,
        groupId: groupId ?? null,
        month,
        year,
        dueDate,
        totalAmount: 0,
        status: 'OPEN',
      },
      update: {}, // already exists — no fields to update on creation path
    });
  }

  /**
   * Recalculate the total amount of a CreditInvoice from all qualifying confirmed transactions.
   * EXPENSE / TRANSFER-from-credit add to total; INCOME / TRANSFER-to-credit subtract from it.
   * The autogenerated fatura transfer is naturally excluded while PENDING because this query uses only CONFIRMED rows.
   */
  private async recalculateCreditInvoiceTotal(
    invoice: { id: number; accountId: number; month: number; year: number; transactionId?: number | null },
    closingDay: number,
    dueDay: number,
  ): Promise<number> {
    const creditAccountId = invoice.accountId;

    // Fetch all CONFIRMED transactions for this credit account.
    // If a previously linked fatura transfer was confirmed early, it must participate in this total
    // so the outstanding value is reduced correctly.
    const allTx = await this.prismaService.transaction.findMany({
      where: {
        status: 'CONFIRMED',
        OR: [
          { accountId: creditAccountId },
          { toAccountId: creditAccountId },
        ],
      },
    });

    let total = 0;
    for (const tx of allTx) {
      const isCreditSource = tx.accountId === creditAccountId;
      const { month, year } = this.calculateInvoiceCycle(
        tx.date,
        tx.type,
        isCreditSource,
        closingDay,
        dueDay,
      );
      if (month !== invoice.month || year !== invoice.year) continue;

      if (tx.type === 'EXPENSE' && isCreditSource) {
        total += Number(tx.amount);
      } else if (tx.type === 'TRANSFER' && isCreditSource) {
        total += Number(tx.amount);
      } else if (tx.type === 'INCOME' && isCreditSource) {
        total -= Number(tx.amount);
      } else if (tx.type === 'TRANSFER' && tx.toAccountId === creditAccountId) {
        total -= Number(tx.amount);
      }
    }

    return Math.max(0, total);
  }

  /**
   * Compute current account balance using the same baseline+transactions strategy used by account balance endpoints.
   */
  private async getCurrentAccountBalanceForAutoInvoice(account: {
    id: number;
    userId: number;
    groupId?: number | null;
  }): Promise<number> {
    const accountId = account.id;
    const now = new Date();

    const lastBalance = await this.prismaService.accountBalance.findFirst({
      where: { accountId },
      orderBy: { date: 'desc' },
    });

    const baselineAmount = lastBalance ? Number(lastBalance.amount) : 0;
    const baselineDate = lastBalance ? lastBalance.date : new Date(0);

    const conditions: Prisma.TransactionWhereInput[] = [
      {
        date: {
          gt: baselineDate,
          lte: now,
        },
      },
      {
        OR: [
          { accountId },
          { toAccountId: accountId },
        ],
      },
    ];

    if (account.groupId !== undefined && account.groupId !== null) {
      conditions.push({ groupId: account.groupId });
    } else {
      conditions.push({ userId: account.userId, groupId: null });
    }

    const transactions = await this.prismaService.transaction.findMany({
      where: { AND: conditions },
      orderBy: { date: 'asc' },
    });

    let net = 0;
    for (const tx of transactions) {
      if (tx.type === 'INCOME') {
        if (tx.accountId === accountId) net += Number(tx.amount);
      } else if (tx.type === 'EXPENSE') {
        if (tx.accountId === accountId) net -= Number(tx.amount);
      } else if (tx.type === 'TRANSFER') {
        if (tx.accountId === accountId) net -= Number(tx.amount);
        if (tx.toAccountId === accountId) net += Number(tx.amount);
      }
    }

    return baselineAmount + net;
  }

  /**
   * Create or update the fatura PENDING TRANSFER transaction for a CreditInvoice.
   * If total is 0 the fatura transaction is deleted.
   */
  private async syncFaturaTransaction(
    invoice: any,
    userId: number,
    groupId: number | null | undefined,
    total: number,
    dueDate: Date,
  ): Promise<void> {
    const creditAccountId = invoice.accountId;
    const monthLabel = String(invoice.month).padStart(2, '0');
    const title = `Fatura ${monthLabel}/${invoice.year}`;

    // Find primary CASH account in the same scope
    const ownershipScope = groupId ? { groupId } : { userId, groupId: null };
    const primaryCashAccount = await this.prismaService.account.findFirst({
      where: {
        ...ownershipScope,
        type: 'CASH',
        isPrimary: true,
      },
    });

    if (total <= 0) {
      // Remove fatura transaction if it exists, but only if it is still PENDING
      if (invoice.transactionId) {
        const existingFaturaTx = await this.prismaService.transaction.findUnique({
          where: { id: invoice.transactionId },
          select: { id: true, status: true },
        });
        if (existingFaturaTx && existingFaturaTx.status === 'PENDING') {
          await this.prismaService.transaction.delete({ where: { id: invoice.transactionId } }).catch(() => null);
          await (this.prismaService as any).creditInvoice.update({
            where: { id: invoice.id },
            data: { totalAmount: 0, transactionId: null, dueDate },
          });
        } else {
          // CONFIRMED transaction: don't delete it; just zero out the total on the invoice
          await (this.prismaService as any).creditInvoice.update({
            where: { id: invoice.id },
            data: { totalAmount: 0, dueDate },
          });
        }
      } else {
        await (this.prismaService as any).creditInvoice.update({
          where: { id: invoice.id },
          data: { totalAmount: 0, dueDate },
        });
      }
      return;
    }

    if (invoice.transactionId) {
      // Update existing fatura transaction — only if still PENDING
      const existingFaturaTx = await this.prismaService.transaction.findUnique({
        where: { id: invoice.transactionId },
        select: { id: true, status: true },
      });

      if (!existingFaturaTx) {
        // Linked transaction was deleted externally — clear stale reference and create a new pending transfer
        if (primaryCashAccount) {
          const newPendingTx = await this.prismaService.transaction.create({
            data: {
              userId,
              groupId: groupId ?? null,
              accountId: primaryCashAccount.id,
              toAccountId: creditAccountId,
              title,
              amount: new Prisma.Decimal(total),
              date: dueDate,
              scheduledDate: dueDate,
              type: 'TRANSFER' as any,
              status: 'PENDING' as any,
            },
          });
          await (this.prismaService as any).creditInvoice.update({
            where: { id: invoice.id },
            data: { totalAmount: new Prisma.Decimal(total), transactionId: newPendingTx.id, dueDate },
          });
        } else {
          await (this.prismaService as any).creditInvoice.update({
            where: { id: invoice.id },
            data: { totalAmount: new Prisma.Decimal(total), transactionId: null, dueDate },
          });
        }
        return;
      } else if (existingFaturaTx.status === 'PENDING') {
        // Re-resolve primary CASH to keep the source account up to date
        const updateData: any = {
          amount: new Prisma.Decimal(total),
          date: dueDate,
          scheduledDate: dueDate,
          title,
        };
        if (primaryCashAccount) {
          updateData.accountId = primaryCashAccount.id;
        }
        await this.prismaService.transaction.update({
          where: { id: invoice.transactionId },
          data: updateData,
        });
      } else if (existingFaturaTx.status === 'CONFIRMED') {
        // Payment was confirmed before invoice closure.
        // Keep invoice OPEN, refresh total, and create a NEW pending transfer for the remaining amount.
        if (primaryCashAccount) {
          const newPendingTx = await this.prismaService.transaction.create({
            data: {
              userId,
              groupId: groupId ?? null,
              accountId: primaryCashAccount.id,
              toAccountId: creditAccountId,
              title,
              amount: new Prisma.Decimal(total),
              date: dueDate,
              scheduledDate: dueDate,
              type: 'TRANSFER' as any,
              status: 'PENDING' as any,
            },
          });

          await (this.prismaService as any).creditInvoice.update({
            where: { id: invoice.id },
            data: {
              totalAmount: new Prisma.Decimal(total),
              transactionId: newPendingTx.id,
              dueDate,
            },
          });
          return;
        }

        // No primary CASH account available: keep invoice total updated but unlink old confirmed transfer.
        await (this.prismaService as any).creditInvoice.update({
          where: { id: invoice.id },
          data: {
            totalAmount: new Prisma.Decimal(total),
            transactionId: null,
            dueDate,
          },
        });
        return;
      }
      // Whether the transaction was updated or is already CONFIRMED, update the invoice total
      await (this.prismaService as any).creditInvoice.update({
        where: { id: invoice.id },
        data: { totalAmount: new Prisma.Decimal(total), dueDate },
      });
    } else {
      // Create new fatura transaction
      // Only create if primary CASH account exists (to avoid self-transfers)
      if (!primaryCashAccount) {
        // No primary CASH account: just update invoice total without transaction
        await (this.prismaService as any).creditInvoice.update({
          where: { id: invoice.id },
          data: {
            totalAmount: new Prisma.Decimal(total),
            transactionId: null,
            dueDate,
          },
        });
        return;
      }

      // Primary CASH exists: create TRANSFER from CASH to Credit card
      const fromAccountId = primaryCashAccount.id;
      const toAccountId = creditAccountId;

      const faturaTx = await this.prismaService.transaction.create({
        data: {
          userId,
          groupId: groupId ?? null,
          accountId: fromAccountId,
          toAccountId: toAccountId,
          title,
          amount: new Prisma.Decimal(total),
          date: dueDate,
          scheduledDate: dueDate,
          type: 'TRANSFER' as any,
          status: 'PENDING' as any,
        },
      });
      await (this.prismaService as any).creditInvoice.update({
        where: { id: invoice.id },
        data: {
          totalAmount: new Prisma.Decimal(total),
          transactionId: faturaTx.id,
          dueDate,
        },
      });
    }
  }

  /**
   * Incremental auto-invoice updater.
   * Applies only the delta between previous and current transaction snapshots for OPEN invoices,
   * and falls back to full recomputation when the target invoice doesn't exist or is immutable.
   */
  private async applyAutoInvoiceDeltaForTransactionChange(
    previousTx: any | null,
    currentTx: any | null,
    userId: number,
    groupId: number | null | undefined,
  ): Promise<void> {
    const candidateAccountIds = new Set<number>();

    const collectIds = (tx: any | null) => {
      if (!tx) return;
      if (tx.accountId) candidateAccountIds.add(Number(tx.accountId));
      if (tx.toAccountId && Number(tx.toAccountId) > 0) candidateAccountIds.add(Number(tx.toAccountId));
    };

    collectIds(previousTx);
    collectIds(currentTx);

    if (candidateAccountIds.size === 0) return;

    const accounts = await this.prismaService.account.findMany({
      where: { id: { in: Array.from(candidateAccountIds) } },
    }) as any[];

    const creditAccounts = new Map<number, any>();
    for (const account of accounts) {
      if (
        account &&
        account.type === 'CREDIT' &&
        account.autoInvoice &&
        account.creditClosingDay &&
        account.creditDueDay
      ) {
        creditAccounts.set(account.id, account);
      }
    }

    if (creditAccounts.size === 0) return;

    type DeltaEntry = {
      accountId: number;
      month: number;
      year: number;
      dueDate: Date;
      delta: number;
    };

    const deltaMap = new Map<string, DeltaEntry>();

    const addDeltaFromTx = (tx: any | null, sign: 1 | -1) => {
      if (!tx || tx.status !== 'CONFIRMED') return;

      for (const [creditAccountId, account] of creditAccounts) {
        const isCreditSource = Number(tx.accountId) === creditAccountId;
        const isCreditDestination = Number(tx.toAccountId) === creditAccountId;

        let contribution = 0;
        if (tx.type === 'EXPENSE' && isCreditSource) {
          contribution = Number(tx.amount);
        } else if (tx.type === 'TRANSFER' && isCreditSource) {
          contribution = Number(tx.amount);
        } else if (tx.type === 'INCOME' && isCreditSource) {
          contribution = -Number(tx.amount);
        } else if (tx.type === 'TRANSFER' && isCreditDestination) {
          contribution = -Number(tx.amount);
        }

        if (contribution === 0) continue;

        const cycle = this.calculateInvoiceCycle(
          tx.date,
          tx.type,
          isCreditSource,
          account.creditClosingDay,
          account.creditDueDay,
        );

        const key = `${creditAccountId}-${cycle.month}-${cycle.year}`;
        const existing = deltaMap.get(key);
        if (existing) {
          existing.delta += sign * contribution;
        } else {
          deltaMap.set(key, {
            accountId: creditAccountId,
            month: cycle.month,
            year: cycle.year,
            dueDate: cycle.dueDate,
            delta: sign * contribution,
          });
        }
      }
    };

    // Remove previous effect and apply current effect.
    addDeltaFromTx(previousTx, -1);
    addDeltaFromTx(currentTx, 1);

    const fallbackAccountIds = new Set<number>();

    for (const [, entry] of deltaMap) {
      if (entry.delta === 0) continue;

      const account = creditAccounts.get(entry.accountId);
      if (!account) continue;

      const invoice = await (this.prismaService as any).creditInvoice.findUnique({
        where: {
          accountId_month_year: {
            accountId: entry.accountId,
            month: entry.month,
            year: entry.year,
          },
        },
      });

      if (!invoice || invoice.status !== 'OPEN') {
        fallbackAccountIds.add(entry.accountId);
        continue;
      }

      const nextTotal = Math.max(0, Number(invoice.totalAmount) + entry.delta);
      await this.syncFaturaTransaction(
        invoice,
        account.userId,
        account.groupId,
        nextTotal,
        entry.dueDate,
      );
    }

    for (const accountId of fallbackAccountIds) {
      const account = creditAccounts.get(accountId);
      await this.handleAutoInvoice(
        [accountId],
        account?.userId ?? userId,
        account?.groupId ?? groupId,
      );
    }
  }

  /**
   * Main entry point: called after a transaction is created/updated/deleted.
   * Manages the auto-invoice for all affected credit accounts.
   *
   * @param affectedAccountIds Set of account IDs that may have changed
   * @param userId Owner user ID
   */
  private async handleAutoInvoice(
    affectedAccountIds: number[],
    userId: number,
    groupId: number | null | undefined,
  ): Promise<void> {
    for (const accountId of affectedAccountIds) {
      const account = await this.prismaService.account.findUnique({
        where: { id: accountId },
      }) as any;

      if (
        !account ||
        account.type !== 'CREDIT' ||
        !account.autoInvoice ||
        !account.creditClosingDay ||
        !account.creditDueDay
      ) {
        continue;
      }

      // Bootstrap mode (first activation): do not backfill past cycles.
      // Start from the current cycle and seed total using current account balance.
      const existingInvoiceCount = await (this.prismaService as any).creditInvoice.count({
        where: { accountId },
      });
      const shouldBootstrapFromCurrentBalance = existingInvoiceCount === 0;
      const currentCycle = this.calculateInvoiceCycle(
        new Date(),
        'EXPENSE',
        true,
        account.creditClosingDay,
        account.creditDueDay,
      );
      const isBeforeCurrentCycle = (month: number, year: number) =>
        year < currentCycle.year || (year === currentCycle.year && month < currentCycle.month);

      // Find every distinct billing cycle that has at least one confirmed transaction
      const allTx = await this.prismaService.transaction.findMany({
        where: {
          status: 'CONFIRMED',
          OR: [
            { accountId },
            { toAccountId: accountId },
          ],
        },
      });

      // Collect unique (month, year) cycles
      const cycleSet = new Map<string, { month: number; year: number; dueDate: Date }>();
      for (const tx of allTx) {
        const isCreditSource = tx.accountId === accountId;
        const cycle = this.calculateInvoiceCycle(
          tx.date,
          tx.type,
          isCreditSource,
          account.creditClosingDay,
          account.creditDueDay,
        );
        if (isBeforeCurrentCycle(cycle.month, cycle.year)) {
          continue;
        }
        const key = `${cycle.month}-${cycle.year}`;
        if (!cycleSet.has(key)) cycleSet.set(key, cycle);
      }

      if (shouldBootstrapFromCurrentBalance) {
        cycleSet.clear();
        cycleSet.set(`${currentCycle.month}-${currentCycle.year}`, currentCycle);
      }

      // Also recalculate any existing OPEN invoices that might now be empty
      // (e.g. when a transaction is deleted). CLOSED and PAID invoices are never modified.
      const existingOpenInvoices = await (this.prismaService as any).creditInvoice.findMany({
        where: { accountId, status: 'OPEN' },
      });
      for (const inv of existingOpenInvoices) {
        if (isBeforeCurrentCycle(inv.month, inv.year)) {
          continue;
        }
        const key = `${inv.month}-${inv.year}`;
        if (!cycleSet.has(key)) {
          // Rebuild the dueDate from existing invoice data
          const maxDay = new Date(inv.year, inv.month, 0).getDate();
          const clampedDueDay = Math.min(account.creditDueDay, maxDay);
          const dueDate = new Date(Date.UTC(inv.year, inv.month - 1, clampedDueDay));
          cycleSet.set(key, { month: inv.month, year: inv.year, dueDate });
        }
      }

      // Process each cycle — only update OPEN invoices; CLOSED/PAID are immutable
      for (const [, cycle] of cycleSet) {
        if (isBeforeCurrentCycle(cycle.month, cycle.year)) {
          continue;
        }

        const invoice = await this.findOrCreateCreditInvoice(
          accountId,
          account.userId,
          account.groupId,
          cycle.month,
          cycle.year,
          cycle.dueDate,
        );

        // Skip invoices that are already closed or paid — they must not be modified
        if (invoice.status === 'CLOSED' || invoice.status === 'PAID') {
          continue;
        }

        let total: number;
        if (
          shouldBootstrapFromCurrentBalance &&
          cycle.month === currentCycle.month &&
          cycle.year === currentCycle.year
        ) {
          const currentBalance = await this.getCurrentAccountBalanceForAutoInvoice(account);
          // For CREDIT accounts, debt is represented by a negative balance.
          total = Math.max(0, -currentBalance);
        } else {
          total = await this.recalculateCreditInvoiceTotal(
            invoice,
            account.creditClosingDay,
            account.creditDueDay,
          );
        }

        await this.syncFaturaTransaction(
          invoice,
          account.userId,
          account.groupId,
          total,
          cycle.dueDate,
        );
      }
    }
  }
}
