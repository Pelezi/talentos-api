import { Injectable, NotFoundException, HttpException } from '@nestjs/common';
import { PrismaService } from '../../common/provider/prisma.provider';
import { AuditService } from '../../common/service/audit.service';
import { TransactionStatus } from '../../../generated/prisma/client';
import {
  CreateInstallmentPlanInput,
  CreateInstallmentTransactionInput,
  UpdateInstallmentPlanInput,
} from '../model/installment-plan.input';
import { InstallmentPlanData } from '../model/installment-plan.data';

@Injectable()
export class InstallmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService
  ) {}

  /**
   * Calcula o valor de cada parcela com juros aplicados
   * Fórmula: totalWithInterest = totalAmount * (1 + interestRate/100)
   *          amountPerInstallment = totalWithInterest / installmentCount
   */
  private calculateInstallments(
    totalAmount: number,
    installmentCount: number,
    interestRate: number
  ): { totalWithInterest: number; amountPerInstallment: number } {
    const totalWithInterest = totalAmount * (1 + interestRate / 100);
    const amountPerInstallment = totalWithInterest / installmentCount;

    return {
      totalWithInterest: Number(totalWithInterest.toFixed(2)),
      amountPerInstallment: Number(amountPerInstallment.toFixed(2)),
    };
  }

  /**
   * Cria um plano de parcelamento sem criar transações ainda
   * Útil para preview ou para criar o plano antes das transações
   */
  async createPlan(
    userId: number,
    input: CreateInstallmentPlanInput
  ): Promise<InstallmentPlanData> {
    // Validações
    if (input.installmentCount < 2) {
      throw new Error('Número de parcelas deve ser no mínimo 2');
    }
    if (input.totalAmount <= 0) {
      throw new Error('Valor total deve ser maior que zero');
    }
    if (input.interestRate < -99.9 || input.interestRate > 1000) {
      throw new Error('Taxa de juros deve estar entre -99,9% (desconto) e 1000%');
    }

    // Calcular valores
    const { totalWithInterest, amountPerInstallment } =
      this.calculateInstallments(
        input.totalAmount,
        input.installmentCount,
        input.interestRate
      );

    // Criar plano
    const plan = await this.prisma.installmentPlan.create({
      data: {
        userId,
        groupId: input.groupId,
        totalAmount: input.totalAmount,
        interestRate: input.interestRate,
        totalWithInterest,
        installmentCount: input.installmentCount,
        amountPerInstallment,
        status: 'ACTIVE',
      },
    });

    return new InstallmentPlanData(plan);
  }

  /**
   * Cria um plano de parcelamento E as transações associadas
   * Esta é a função principal para criar transações parceladas
   */
  async createInstallmentTransaction(
    userId: number,
    input: CreateInstallmentTransactionInput
  ): Promise<InstallmentPlanData> {
    // Validações
    if (input.installmentCount < 2) {
      throw new Error('Número de parcelas deve ser no mínimo 2');
    }
    if (input.amount <= 0) {
      throw new Error('Valor total deve ser maior que zero');
    }

    // Calcular valores
    const { totalWithInterest, amountPerInstallment } =
      this.calculateInstallments(
        input.amount,
        input.installmentCount,
        input.interestRate
      );

    // Criar plano e transações em uma transação do banco
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Criar o plano
      const plan = await tx.installmentPlan.create({
        data: {
          userId,
          groupId: input.groupId,
          totalAmount: input.amount,
          interestRate: input.interestRate,
          totalWithInterest,
          installmentCount: input.installmentCount,
          amountPerInstallment,
          status: 'ACTIVE',
        },
      });

      // 2. Criar transações parceladas
      const transactions = [];
      const baseDate = new Date(input.date);

      for (let i = 0; i < input.installmentCount; i++) {
        // Calcular data da parcela (mês a mês)
        const installmentDate = new Date(baseDate);
        installmentDate.setMonth(baseDate.getMonth() + i);

        // Determinar status da parcela:
        // - isPending=false (padrão): todas CONFIRMED
        // - isPending=true + firstInstallmentConfirmed=true: primeira CONFIRMED, demais PENDING
        // - isPending=true: todas PENDING
        let status: TransactionStatus;
        let confirmedAt: Date | null;
        let scheduledDate: Date | null;
        if (!input.isPending) {
          status = TransactionStatus.CONFIRMED;
          confirmedAt = new Date();
          scheduledDate = null;
        } else if (input.firstInstallmentConfirmed && i === 0) {
          status = TransactionStatus.CONFIRMED;
          confirmedAt = new Date();
          scheduledDate = null;
        } else {
          status = TransactionStatus.PENDING;
          confirmedAt = null;
          scheduledDate = installmentDate;
        }

        const transaction = await tx.transaction.create({
          data: {
            userId,
            groupId: input.groupId,
            subcategoryId: input.subcategoryId,
            accountId: input.accountId,
            title: input.title
              ? `${input.title} (${i + 1}/${input.installmentCount})`
              : `Parcela ${i + 1}/${input.installmentCount}`,
            amount: amountPerInstallment,
            description: input.description,
            date: installmentDate,
            type: input.type,
            status,
            confirmedAt,
            scheduledDate,
            installmentPlanId: plan.id,
            recurrenceIndex: i, // Usar recurrenceIndex para número da parcela
          },
        });

        transactions.push(transaction);
      }

      // Retornar plano com transações
      return await tx.installmentPlan.findUnique({
        where: { id: plan.id },
        include: { transactions: true },
      });
    });

    if (!result) {
      throw new HttpException('Plano não encontrado após criação', 500);
    }

    // Registrar auditoria
    await this.auditService.log({
      userId,
      groupId: input.groupId,
      entityType: 'InstallmentPlan',
      entityId: result.id,
      action: 'CREATE',
      changes: {
        totalAmount: { before: null, after: input.amount },
        installmentCount: { before: null, after: input.installmentCount },
        interestRate: { before: null, after: input.interestRate },
        totalWithInterest: { before: null, after: totalWithInterest },
      },
      description: `Parcelamento criado: ${input.installmentCount}x de R$ ${amountPerInstallment.toFixed(2)}`,
    });

    // Se tem taxa, criar um novo plano de parcelamento separado para a taxa
    if (input.feeAmount && input.feeAmount > 0) {
      const feeAccountId = input.feeAccountId ?? input.accountId;
      const baseTitle = input.title ?? '';
      await this.createInstallmentTransaction(userId, {
        subcategoryId: input.subcategoryId,
        accountId: feeAccountId,
        title: `Taxa - ${baseTitle}`,
        amount: input.feeAmount,
        description: `Taxa do parcelamento${baseTitle ? ` "${baseTitle}"` : ''}`,
        date: input.date,
        type: input.type,
        groupId: input.groupId,
        installmentCount: input.installmentCount,
        interestRate: 0,
      });
    }

    return new InstallmentPlanData(result);
  }

  /**
   * Busca um plano de parcelamento por ID com todas as transações
   * Verifica propriedade: usuário dono ou membro do grupo
   */
  async findById(
    userId: number,
    planId: number
  ): Promise<InstallmentPlanData> {
    const plan = await this.prisma.installmentPlan.findFirst({
      where: { id: Number(planId) },
      include: { transactions: { orderBy: { date: 'asc' } } },
    });

    if (!plan) {
      throw new NotFoundException('Plano de parcelamento não encontrado');
    }

    // Verificar acesso: dono ou membro do grupo
    if (plan.groupId) {
      const member = await this.prisma.groupMember.findFirst({
        where: { groupId: plan.groupId, userId },
      });
      if (!member) throw new NotFoundException('Plano de parcelamento não encontrado');
    } else if (plan.userId !== userId) {
      throw new NotFoundException('Plano de parcelamento não encontrado');
    }

    return new InstallmentPlanData(plan);
  }

  /**
   * Lista todos os planos de parcelamento do usuário ou do grupo
   */
  async findByUser(userId: number, groupId?: number): Promise<InstallmentPlanData[]> {
    const where: any = {};
    if (groupId !== undefined) {
      where.groupId = groupId;
    } else {
      where.userId = userId;
      where.groupId = null;
    }
    const plans = await this.prisma.installmentPlan.findMany({
      where,
      include: { transactions: { orderBy: { date: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });

    return plans.map((plan) => new InstallmentPlanData(plan));
  }

  /**
   * Atualiza um plano de parcelamento
   * Suporta alteração de: valor total, número de parcelas, taxa de juros,
   * título, descrição, subcategoria, conta e status.
   * Qualquer mudança financeira recalcula amountPerInstallment das parcelas PENDENTES.
   * Se feeAmount for fornecido, cria um novo plano de parcelamento de taxa separado.
   */
  async update(
    userId: number,
    planId: number,
    input: UpdateInstallmentPlanInput
  ): Promise<InstallmentPlanData> {
    // Buscar plano atual com transações
    const plan = await this.prisma.installmentPlan.findFirst({
      where: { id: planId },
      include: { transactions: { orderBy: { recurrenceIndex: 'asc' } } },
    });

    if (!plan) {
      throw new NotFoundException('Plano de parcelamento não encontrado');
    }

    // Verificar acesso: dono ou membro do grupo
    if (plan.groupId) {
      const member = await this.prisma.groupMember.findFirst({
        where: { groupId: plan.groupId, userId },
      });
      if (!member) throw new NotFoundException('Plano de parcelamento não encontrado');
    } else if (plan.userId !== userId) {
      throw new NotFoundException('Plano de parcelamento não encontrado');
    }

    // Valores financeiros efetivos após a atualização
    const oldTotalAmount = parseFloat(plan.totalAmount.toString());
    const oldInstallmentCount = plan.installmentCount;
    const oldInterestRate = parseFloat(plan.interestRate.toString());
    const oldStatus = plan.status;

    const newTotalAmount = input.totalAmount ?? oldTotalAmount;
    const newInstallmentCount = input.installmentCount ?? oldInstallmentCount;
    const newInterestRate = input.interestRate ?? oldInterestRate;
    const newStatus = input.status ?? oldStatus;

    const needsFinancialRecalc =
      input.totalAmount !== undefined ||
      input.installmentCount !== undefined ||
      input.interestRate !== undefined;

    const { totalWithInterest, amountPerInstallment } =
      this.calculateInstallments(newTotalAmount, newInstallmentCount, newInterestRate);

    // Detectar mudanças para auditoria
    const before = {
      totalAmount: oldTotalAmount,
      installmentCount: oldInstallmentCount,
      interestRate: oldInterestRate,
      totalWithInterest: parseFloat(plan.totalWithInterest.toString()),
      amountPerInstallment: parseFloat(plan.amountPerInstallment.toString()),
      status: oldStatus,
    };
    const after = {
      totalAmount: newTotalAmount,
      installmentCount: newInstallmentCount,
      interestRate: newInterestRate,
      totalWithInterest,
      amountPerInstallment,
      status: newStatus,
    };
    const changes = this.auditService.detectChanges(before, after, [
      'totalAmount',
      'installmentCount',
      'interestRate',
      'totalWithInterest',
      'amountPerInstallment',
      'status',
    ]);

    // Executar atualizações no banco em uma transação
    await this.prisma.$transaction(async (tx) => {
      // 1. Atualizar o plano
      const planUpdateData: Record<string, any> = {};
      if (needsFinancialRecalc) {
        planUpdateData.totalAmount = newTotalAmount;
        planUpdateData.installmentCount = newInstallmentCount;
        planUpdateData.interestRate = newInterestRate;
        planUpdateData.totalWithInterest = totalWithInterest;
        planUpdateData.amountPerInstallment = amountPerInstallment;
      }
      if (input.status !== undefined) {
        planUpdateData.status = input.status;
      }
      if (Object.keys(planUpdateData).length > 0) {
        await tx.installmentPlan.update({
          where: { id: planId },
          data: planUpdateData,
        });
      }

      // 2. Montar atualização em massa para transações PENDENTES
      const bulkUpdate: Record<string, any> = {};
      if (needsFinancialRecalc) {
        bulkUpdate.amount = amountPerInstallment;
      }
      if (input.subcategoryId !== undefined) {
        bulkUpdate.subcategoryId = input.subcategoryId;
      }
      if (input.accountId !== undefined) {
        bulkUpdate.accountId = input.accountId;
      }
      if (input.description !== undefined) {
        bulkUpdate.description = input.description;
      }

      if (Object.keys(bulkUpdate).length > 0) {
        await tx.transaction.updateMany({
          where: {
            installmentPlanId: planId,
            status: 'PENDING',
            ...(input.fromRecurrenceIndex !== undefined && {
              recurrenceIndex: { gte: input.fromRecurrenceIndex },
            }),
          },
          data: bulkUpdate,
        });
      }

      // 3. Atualizar título individualmente (precisa do número da parcela)
      if (input.title !== undefined) {
        const pendingTransactions = plan.transactions.filter(
          (t) =>
            t.status === 'PENDING' &&
            (input.fromRecurrenceIndex === undefined ||
              (t.recurrenceIndex ?? 0) >= input.fromRecurrenceIndex)
        );
        for (const t of pendingTransactions) {
          const installmentNum = (t.recurrenceIndex ?? 0) + 1;
          const newTitle = input.title
            ? `${input.title} (${installmentNum}/${newInstallmentCount})`
            : `Parcela ${installmentNum}/${newInstallmentCount}`;
          await tx.transaction.update({
            where: { id: t.id },
            data: { title: newTitle },
          });
        }
      }
    });

    // 4. Se feeAmount fornecido, criar um novo plano de parcelamento de taxa separado
    if (input.feeAmount && input.feeAmount > 0) {
      const refTransaction = plan.transactions[0];
      const baseTitle = input.title ?? (refTransaction?.title?.replace(/ \(\d+\/\d+\)$/, '') ?? '');
      const feeAccountId = input.feeAccountId ?? refTransaction?.accountId ?? 0;
      const subcategoryId = input.subcategoryId ?? refTransaction?.subcategoryId ?? undefined;
      const txType = (refTransaction?.type as 'EXPENSE' | 'INCOME') ?? 'EXPENSE';

      await this.createInstallmentTransaction(userId, {
        subcategoryId,
        accountId: feeAccountId,
        title: `Taxa - ${baseTitle}`,
        amount: input.feeAmount,
        description: `Taxa do parcelamento${baseTitle ? ` "${baseTitle}"` : ''}`,
        date: refTransaction?.date ?? new Date(),
        type: txType,
        groupId: plan.groupId ?? undefined,
        installmentCount: newInstallmentCount,
        interestRate: 0,
      });
    }

    // Log de auditoria
    if (changes) {
      await this.auditService.log({
        userId,
        groupId: plan.groupId ?? undefined,
        entityType: 'InstallmentPlan',
        entityId: planId,
        action: 'UPDATE',
        changes,
        description: this.auditService.generateChangeDescription(
          'InstallmentPlan',
          'UPDATE',
          changes
        ),
      });
    }

    // Retornar plano atualizado
    return this.findById(userId, planId);
  }

  /**
   * Cancela um plano de parcelamento
   * Opção 1: Manter transações confirmadas (padrão)
   * Opção 2: Deletar TODAS as transações
   */
  async cancel(
    userId: number,
    planId: number,
    deleteTransactions = false
  ): Promise<void> {
    const plan = await this.prisma.installmentPlan.findFirst({
      where: { id: planId },
    });

    if (!plan) {
      throw new NotFoundException('Plano de parcelamento não encontrado');
    }

    // Verificar acesso: dono ou membro do grupo
    if (plan.groupId) {
      const member = await this.prisma.groupMember.findFirst({
        where: { groupId: plan.groupId, userId },
      });
      if (!member) throw new NotFoundException('Plano de parcelamento não encontrado');
    } else if (plan.userId !== userId) {
      throw new NotFoundException('Plano de parcelamento não encontrado');
    }

    if (deleteTransactions) {
      // Deletar plano e todas as transações (cascade)
      await this.prisma.installmentPlan.delete({
        where: { id: planId },
      });

      // Registrar auditoria
      await this.auditService.log({
        userId,
        groupId: plan.groupId ?? undefined,
        entityType: 'InstallmentPlan',
        entityId: planId,
        action: 'DELETE',
        description: 'Plano de parcelamento deletado com todas as transações',
      });
    } else {
      // Apenas marcar como cancelado e deletar transações PENDENTES
      await this.prisma.$transaction(async (tx) => {
        await tx.installmentPlan.update({
          where: { id: planId },
          data: { status: 'CANCELLED' },
        });

        await tx.transaction.deleteMany({
          where: {
            installmentPlanId: planId,
            status: 'PENDING',
          },
        });
      });

      // Registrar auditoria
      await this.auditService.log({
        userId,
        groupId: plan.groupId ?? undefined,
        entityType: 'InstallmentPlan',
        entityId: planId,
        action: 'CANCEL',
        changes: {
          status: { before: plan.status, after: 'CANCELLED' },
        },
        description: 'Plano de parcelamento cancelado (transações pendentes deletadas)',
      });
    }
  }

  /**
   * Confirma uma parcela específica
   * Move de PENDING para CONFIRMED e atualiza data
   */
  async confirmInstallment(
    userId: number,
    transactionId: number
  ): Promise<void> {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id: transactionId, installmentPlanId: { not: null } },
    });

    if (!transaction) {
      throw new NotFoundException('Transação parcelada não encontrada');
    }

    // Verificar acesso: dono ou membro do grupo
    if (transaction.groupId) {
      const member = await this.prisma.groupMember.findFirst({
        where: { groupId: transaction.groupId, userId },
      });
      if (!member) throw new NotFoundException('Transação parcelada não encontrada');
    } else if (transaction.userId !== userId) {
      throw new NotFoundException('Transação parcelada não encontrada');
    }

    if (transaction.status === 'CONFIRMED') {
      throw new Error('Esta parcela já foi confirmada');
    }

    // Confirmar transação
    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        date: new Date(), // Atualizar data para agora
        scheduledDate: null,
      },
    });

    // Verificar se todas as parcelas foram confirmadas
    const plan = await this.prisma.installmentPlan.findUnique({
      where: { id: transaction.installmentPlanId! },
      include: { transactions: true },
    });

    if (plan) {
      const allConfirmed = plan.transactions.every(
        (t) => t.status === 'CONFIRMED'
      );

      if (allConfirmed) {
        await this.prisma.installmentPlan.update({
          where: { id: plan.id },
          data: { status: 'COMPLETED' },
        });
      }
    }
  }
}
