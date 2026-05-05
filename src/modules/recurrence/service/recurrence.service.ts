import { Injectable, NotFoundException, HttpException } from '@nestjs/common';
import { PrismaService } from '../../common/provider/prisma.provider';
import { AuditService } from '../../common/service/audit.service';
import {
  CreateRecurrenceRuleInput,
  CreateRecurrenceTransactionInput,
  GenerateOccurrencesInput,
  UpdateRecurrenceRuleInput,
} from '../model/recurrence-rule.input';
import { RecurrenceRuleData } from '../model/recurrence-rule.data';
import { RecurrenceFrequency, RecurrenceRuleStatus } from '../../../generated/prisma/client';

@Injectable()
export class RecurrenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService
  ) {}

  /**
   * Retorna a data correspondente à N-ésima ocorrência de um dia da semana num dado mês.
   * nth: 1-4 (primeira a quarta), -1 (última).
   * weekday: 0=Dom, 1=Seg, ..., 6=Sáb.
   */
  private getNthWeekdayOfMonth(year: number, baseMonth: number, nth: number, weekday: number): Date {
    // Normalizar mês (pode ser > 11 se vier de um cálculo de intervalo)
    const ref = new Date(year, baseMonth, 1);
    const y = ref.getFullYear();
    const m = ref.getMonth();

    if (nth === -1) {
      // Última ocorrência: começa do último dia do mês e volta
      const last = new Date(y, m + 1, 0);
      while (last.getDay() !== weekday) {
        last.setDate(last.getDate() - 1);
      }
      return last;
    }

    // Nth ocorrência (1-4): encontra o primeiro dia da semana no mês e avança
    const first = new Date(y, m, 1);
    while (first.getDay() !== weekday) {
      first.setDate(first.getDate() + 1);
    }
    first.setDate(first.getDate() + (nth - 1) * 7);
    // Se passou do mês (ex: 5ª sexta quando não existe), recua para a última
    if (first.getMonth() !== m) {
      first.setDate(first.getDate() - 7);
    }
    return first;
  }

  /**
   * Calcula a próxima data de ocorrência baseada na frequência
   */
  private calculateNextDate(
    currentDate: Date,
    frequency: RecurrenceFrequency,
    interval: number,
    dayOfMonth?: number | null,
    daysOfWeek?: string | null,
    weekOfMonth?: number | null
  ): Date {
    const nextDate = new Date(currentDate);

    switch (frequency) {
      case 'DAILY':
        nextDate.setDate(nextDate.getDate() + interval);
        break;

      case 'WEEKLY':
        if (daysOfWeek) {
          const days = daysOfWeek.split(',').map(Number).sort((a, b) => a - b);
          const currentDay = nextDate.getDay();
          // Próximo dia nesta semana (estritamente maior que currentDay)
          const nextDayInWeek = days.find((d) => d > currentDay);

          if (nextDayInWeek !== undefined) {
            nextDate.setDate(nextDate.getDate() + (nextDayInWeek - currentDay));
          } else {
            // Wrap: avança para o primeiro dia do próximo ciclo
            const firstDay = days[0];
            const daysUntilNextWeekStart = 7 - currentDay; // dias até o próximo domingo
            nextDate.setDate(nextDate.getDate() + daysUntilNextWeekStart + firstDay + (interval - 1) * 7);
          }
        } else {
          nextDate.setDate(nextDate.getDate() + 7 * interval);
        }
        break;

      case 'BIWEEKLY':
        nextDate.setDate(nextDate.getDate() + 14 * interval);
        break;

      case 'MONTHLY': {
        if (weekOfMonth != null && daysOfWeek) {
          // Mensal por dia da semana (ex: toda 2ª segunda-feira)
          const targetWeekday = parseInt(daysOfWeek.split(',')[0], 10);
          return this.getNthWeekdayOfMonth(
            nextDate.getFullYear(),
            nextDate.getMonth() + interval,
            weekOfMonth,
            targetWeekday
          );
        }
        // Mensal por data — aritmética segura para evitar overflow de setMonth
        const targetDay = dayOfMonth ?? nextDate.getDate();
        const refMonth = new Date(nextDate.getFullYear(), nextDate.getMonth() + interval, 1);
        const lastDay = new Date(refMonth.getFullYear(), refMonth.getMonth() + 1, 0).getDate();
        return new Date(refMonth.getFullYear(), refMonth.getMonth(), Math.min(targetDay, lastDay));
      }

      case 'QUARTERLY':
        nextDate.setMonth(nextDate.getMonth() + 3 * interval);
        break;

      case 'SEMIANNUALLY':
        nextDate.setMonth(nextDate.getMonth() + 6 * interval);
        break;

      case 'ANNUALLY': {
        // Aritmética segura para anos (ex: 29/02 → 28/02 em anos não bissextos)
        const targetYear = nextDate.getFullYear() + interval;
        const month = nextDate.getMonth();
        const day = nextDate.getDate();
        const lastDay = new Date(targetYear, month + 1, 0).getDate();
        return new Date(targetYear, month, Math.min(day, lastDay));
      }

      default:
        break;
    }

    return nextDate;
  }

  /**
   * Verifica se deve gerar mais ocorrências
   */
  private shouldGenerateMore(
    rule: {
      occurrenceGenerated: number;
      occurrenceCount?: number;
      endDate?: Date;
      status: RecurrenceRuleStatus;
    },
    nextDate: Date
  ): boolean {
    // Se pausada ou cancelada, não gerar
    if (rule.status !== 'ACTIVE') return false;

    // Se atingiu limite de ocorrências, não gerar
    if (
      rule.occurrenceCount &&
      rule.occurrenceGenerated >= rule.occurrenceCount
    ) {
      return false;
    }

    // Se passou da data final, não gerar
    if (rule.endDate && nextDate > rule.endDate) {
      return false;
    }

    return true;
  }

  /**
   * Cria uma regra de recorrência sem transações (para preview)
   */
  async createRule(
    userId: number,
    input: CreateRecurrenceRuleInput
  ): Promise<RecurrenceRuleData> {
    // Validações
    if (input.interval && input.interval < 1) {
      throw new Error('Intervalo deve ser no mínimo 1');
    }

    const rule = await this.prisma.recurrenceRule.create({
      data: {
        userId,
        groupId: input.groupId,
        frequency: input.frequency,
        interval: input.interval ?? 1,
        daysOfWeek: input.daysOfWeek,
        dayOfMonth: input.dayOfMonth,
        startDate: input.startDate,
        endDate: input.endDate,
        occurrenceCount: input.occurrenceCount,
        status: 'ACTIVE',
      },
    });

    return new RecurrenceRuleData(rule);
  }

  /**
   * Cria uma transação recorrente com regra e transações iniciais
   */
  async createRecurrenceTransaction(
    userId: number,
    input: CreateRecurrenceTransactionInput
  ): Promise<RecurrenceRuleData> {
    // Validações
    if (input.amount <= 0) {
      throw new Error('Valor deve ser maior que zero');
    }

    const generateCount = input.initialGenerationCount ?? 12;

    // Criar regra e transações em transação do banco
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Criar regra
      const rule = await tx.recurrenceRule.create({
        data: {
          userId,
          groupId: input.groupId,
          frequency: input.frequency,
          interval: input.interval ?? 1,
          daysOfWeek: input.daysOfWeek,
          dayOfMonth: input.dayOfMonth,
          weekOfMonth: input.weekOfMonth ?? null,
          startDate: new Date(input.startDate + 'T00:00:00Z'),
          endDate: input.endDate ? new Date(input.endDate + 'T23:59:59Z') : null,
          occurrenceCount: input.occurrenceCount,
          status: 'ACTIVE',
        },
      });

      // 2. Gerar transações iniciais
      let currentDate = new Date(input.startDate);
      let generated = 0;

      while (
        generated < generateCount &&
        this.shouldGenerateMore(
          {
            occurrenceGenerated: generated,
            occurrenceCount: input.occurrenceCount,
            endDate: input.endDate ? new Date(input.endDate + 'T23:59:59Z') : undefined,
            status: rule.status,
          },
          currentDate
        )
      ) {
        // Todas as ocorrências iniciais devem começar como pendentes
        const status = 'PENDING';
        const confirmedAt = null;
        const scheduledDate = currentDate;

        await tx.transaction.create({
          data: {
            userId,
            groupId: input.groupId,
            subcategoryId: input.subcategoryId,
            accountId: input.accountId,
            title: input.title,
            amount: input.amount,
            description: input.description,
            date: currentDate,
            type: input.type,
            status,
            confirmedAt,
            scheduledDate,
            recurrenceRuleId: rule.id,
            recurrenceIndex: generated,
            // Taxa apenas na primeira transação
            feeAmount: generated === 0 ? input.feeAmount : null,
            feeAccountId: generated === 0 ? input.feeAccountId : null,
          },
        });

        generated++;
        currentDate = this.calculateNextDate(
          currentDate,
          input.frequency,
          input.interval ?? 1,
          input.dayOfMonth,
          input.daysOfWeek,
          input.weekOfMonth
        );
      }

      // 3. Atualizar contador de ocorrências geradas
      await tx.recurrenceRule.update({
        where: { id: rule.id },
        data: { occurrenceGenerated: generated },
      });

      // Verificar se já está completa
      if (
        input.occurrenceCount &&
        generated >= input.occurrenceCount
      ) {
        await tx.recurrenceRule.update({
          where: { id: rule.id },
          data: { status: 'COMPLETED' },
        });
      }

      // Retornar regra com transações
      return await tx.recurrenceRule.findUnique({
        where: { id: rule.id },
        include: { transactions: { orderBy: { date: 'asc' } } },
      });
    });

    if (!result) {
      throw new HttpException('Regra não encontrada após criação', 500);
    }

    // Registrar auditoria
    await this.auditService.log({
      userId,
      groupId: input.groupId,
      entityType: 'RecurrenceRule',
      entityId: result.id,
      action: 'CREATE',
      changes: {
        frequency: { before: null, after: input.frequency },
        startDate: { before: null, after: input.startDate },
        endDate: { before: null, after: input.endDate },
        occurrenceCount: { before: null, after: input.occurrenceCount },
      },
      description: `Recorrência criada: ${this.formatFrequency(input.frequency)} a partir de ${input.startDate}`,
    });

    return new RecurrenceRuleData(result);
  }

  /**
   * Busca regra por ID com transações
   * Verifica propriedade: usuário dono ou membro do grupo
   */
  async findById(
    userId: number,
    ruleId: number
  ): Promise<RecurrenceRuleData> {
    const rule = await this.prisma.recurrenceRule.findFirst({
      where: { id: Number(ruleId) },
      include: { transactions: { orderBy: { date: 'asc' } } },
    });

    if (!rule) {
      throw new NotFoundException('Regra de recorrência não encontrada');
    }

    // Verificar acesso: dono ou membro do grupo
    if (rule.groupId) {
      const member = await this.prisma.groupMember.findFirst({
        where: { groupId: rule.groupId, userId },
      });
      if (!member) throw new NotFoundException('Regra de recorrência não encontrada');
    } else if (rule.userId !== userId) {
      throw new NotFoundException('Regra de recorrência não encontrada');
    }

    return new RecurrenceRuleData(rule);
  }

  /**
   * Lista todas as regras do usuário ou do grupo
   */
  async findByUser(userId: number, groupId?: number): Promise<RecurrenceRuleData[]> {
    const where: any = {};
    if (groupId !== undefined) {
      where.groupId = groupId;
    } else {
      where.userId = userId;
      where.groupId = null;
    }
    const rules = await this.prisma.recurrenceRule.findMany({
      where,
      include: { transactions: { orderBy: { date: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });

    return rules.map((rule) => new RecurrenceRuleData(rule));
  }

  /**
   * Atualiza regra de recorrência
   */
  async update(
    userId: number,
    ruleId: number,
    input: UpdateRecurrenceRuleInput
  ): Promise<RecurrenceRuleData> {
    const rule = await this.prisma.recurrenceRule.findFirst({
      where: { id: ruleId },
    });

    if (!rule) {
      throw new NotFoundException('Regra de recorrência não encontrada');
    }

    // Verificar acesso: dono ou membro do grupo
    if (rule.groupId) {
      const member = await this.prisma.groupMember.findFirst({
        where: { groupId: rule.groupId, userId },
      });
      if (!member) throw new NotFoundException('Regra de recorrência não encontrada');
    } else if (rule.userId !== userId) {
      throw new NotFoundException('Regra de recorrência não encontrada');
    }

    // Detectar mudanças
    const changes = this.auditService.detectChanges(
      {
        status: rule.status,
        endDate: rule.endDate,
        occurrenceCount: rule.occurrenceCount,
      },
      {
        status: input.status ?? rule.status,
        endDate: input.endDate ?? rule.endDate,
        occurrenceCount: input.occurrenceCount ?? rule.occurrenceCount,
      },
      ['status', 'endDate', 'occurrenceCount']
    );

    // Atualizar status
    await this.prisma.recurrenceRule.update({
      where: { id: ruleId },
      data: {
        status: input.status,
        endDate: input.endDate,
        occurrenceCount: input.occurrenceCount,
      },
    });

    // Atualizar transações PENDING vinculadas se campos de conteúdo foram fornecidos
    const contentUpdate: Record<string, any> = {};
    if (input.amount !== undefined) contentUpdate.amount = input.amount;
    if (input.title !== undefined) contentUpdate.title = input.title;
    if (input.description !== undefined) contentUpdate.description = input.description;
    if (input.subcategoryId !== undefined) contentUpdate.subcategoryId = input.subcategoryId;
    if (input.accountId !== undefined) contentUpdate.accountId = input.accountId;

    if (Object.keys(contentUpdate).length > 0) {
      await this.prisma.transaction.updateMany({
        where: {
          recurrenceRuleId: ruleId,
          status: 'PENDING',
          ...(input.fromRecurrenceIndex !== undefined && {
            recurrenceIndex: { gte: input.fromRecurrenceIndex },
          }),
        },
        data: contentUpdate,
      });
    }

    // Registrar auditoria se houve mudanças
    if (changes && Object.keys(changes).length > 0) {
      await this.auditService.log({
        userId,
        groupId: rule.groupId ?? undefined,
        entityType: 'RecurrenceRule',
        entityId: ruleId,
        action: 'UPDATE',
        changes,
        description: this.auditService.generateChangeDescription(
          'RecurrenceRule',
          'UPDATE',
          changes
        ),
      });
    }

    return this.findById(userId, ruleId);
  }

  /**
   * Gera mais ocorrências de uma regra existente
   */
  async generateOccurrences(
    userId: number,
    ruleId: number,
    input: GenerateOccurrencesInput
  ): Promise<RecurrenceRuleData> {
    const rule = await this.prisma.recurrenceRule.findFirst({
      where: { id: ruleId },
      include: { transactions: { orderBy: { date: 'desc' }, take: 1 } },
    });

    if (!rule) {
      throw new NotFoundException('Regra de recorrência não encontrada');
    }

    // Verificar acesso: dono ou membro do grupo
    if (rule.groupId) {
      const member = await this.prisma.groupMember.findFirst({
        where: { groupId: rule.groupId, userId },
      });
      if (!member) throw new NotFoundException('Regra de recorrência não encontrada');
    } else if (rule.userId !== userId) {
      throw new NotFoundException('Regra de recorrência não encontrada');
    }

    if (rule.status !== 'ACTIVE') {
      throw new Error('Regra não está ativa');
    }

    // Buscar última transação para calcular próxima data
    const lastTransaction = rule.transactions[0];
    if (!lastTransaction) {
      throw new Error('Nenhuma transação encontrada para esta regra');
    }

    let currentDate = this.calculateNextDate(
      lastTransaction.date,
      rule.frequency,
      rule.interval,
      rule.dayOfMonth ?? undefined,
      rule.daysOfWeek ?? undefined,
      rule.weekOfMonth ?? undefined
    );

    const generateCount = input.count ?? 12;
    let generated = 0;

    await this.prisma.$transaction(async (tx) => {
      while (
        generated < generateCount &&
        this.shouldGenerateMore(
          {
            occurrenceGenerated: rule.occurrenceGenerated + generated,
            occurrenceCount: rule.occurrenceCount ?? undefined,
            endDate: rule.endDate ?? undefined,
            status: rule.status,
          },
          currentDate
        )
      ) {
        await tx.transaction.create({
          data: {
            userId,
            groupId: rule.groupId,
            subcategoryId: lastTransaction.subcategoryId,
            accountId: lastTransaction.accountId,
            title: lastTransaction.title,
            amount: lastTransaction.amount,
            description: lastTransaction.description,
            date: currentDate,
            type: lastTransaction.type,
            status: 'PENDING',
            scheduledDate: currentDate,
            recurrenceRuleId: rule.id,
            recurrenceIndex: rule.occurrenceGenerated + generated,
          },
        });

        generated++;
        currentDate = this.calculateNextDate(
          currentDate,
          rule.frequency,
          rule.interval,
          rule.dayOfMonth ?? undefined,
          rule.daysOfWeek ?? undefined,
          rule.weekOfMonth ?? undefined
        );
      }

      // Atualizar contador
      await tx.recurrenceRule.update({
        where: { id: ruleId },
        data: { occurrenceGenerated: rule.occurrenceGenerated + generated },
      });

      // Verificar se completou
      if (
        rule.occurrenceCount &&
        rule.occurrenceGenerated + generated >= rule.occurrenceCount
      ) {
        await tx.recurrenceRule.update({
          where: { id: ruleId },
          data: { status: 'COMPLETED' },
        });
      }
    });

    return this.findById(userId, ruleId);
  }

  /**
   * Cancela uma regra de recorrência
   * Opções: manter transações confirmadas ou deletar tudo
   */
  async cancel(
    userId: number,
    ruleId: number,
    deleteTransactions = false
  ): Promise<void> {
    const rule = await this.prisma.recurrenceRule.findFirst({
      where: { id: ruleId },
    });

    if (!rule) {
      throw new NotFoundException('Regra de recorrência não encontrada');
    }

    // Verificar acesso: dono ou membro do grupo
    if (rule.groupId) {
      const member = await this.prisma.groupMember.findFirst({
        where: { groupId: rule.groupId, userId },
      });
      if (!member) throw new NotFoundException('Regra de recorrência não encontrada');
    } else if (rule.userId !== userId) {
      throw new NotFoundException('Regra de recorrência não encontrada');
    }

    if (deleteTransactions) {
      // Deletar regra e todas as transações (cascade)
      await this.prisma.recurrenceRule.delete({
        where: { id: ruleId },
      });

      // Registrar auditoria
      await this.auditService.log({
        userId,
        groupId: rule.groupId ?? undefined,
        entityType: 'RecurrenceRule',
        entityId: ruleId,
        action: 'DELETE',
        description: 'Regra de recorrência deletada com todas as transações',
      });
    } else {
      // Marcar como cancelada e deletar transações PENDENTES
      await this.prisma.$transaction(async (tx) => {
        await tx.recurrenceRule.update({
          where: { id: ruleId },
          data: { status: 'CANCELLED' },
        });

        await tx.transaction.deleteMany({
          where: {
            recurrenceRuleId: ruleId,
            status: 'PENDING',
          },
        });
      });

      // Registrar auditoria
      await this.auditService.log({
        userId,
        groupId: rule.groupId ?? undefined,
        entityType: 'RecurrenceRule',
        entityId: ruleId,
        action: 'CANCEL',
        changes: {
          status: { before: rule.status, after: 'CANCELLED' },
        },
        description: 'Regra de recorrência cancelada (transações pendentes deletadas)',
      });
    }
  }

  /**
   * Confirma uma ocorrência específica
   */
  async confirmOccurrence(
    userId: number,
    transactionId: number
  ): Promise<void> {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id: transactionId, recurrenceRuleId: { not: null } },
    });

    if (!transaction) {
      throw new NotFoundException('Transação recorrente não encontrada');
    }

    // Verificar acesso: dono ou membro do grupo
    if (transaction.groupId) {
      const member = await this.prisma.groupMember.findFirst({
        where: { groupId: transaction.groupId, userId },
      });
      if (!member) throw new NotFoundException('Transação recorrente não encontrada');
    } else if (transaction.userId !== userId) {
      throw new NotFoundException('Transação recorrente não encontrada');
    }

    if (transaction.status === 'CONFIRMED') {
      throw new Error('Esta transação já foi confirmada');
    }

    // Confirmar transação
    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        date: new Date(),
        scheduledDate: null,
      },
    });
  }

  /**
   * Formata frequência para exibição em português
   */
  private formatFrequency(frequency: RecurrenceFrequency): string {
    const map: Record<RecurrenceFrequency, string> = {
      DAILY: 'Diário',
      WEEKLY: 'Semanal',
      MONTHLY: 'Mensal',
      BIWEEKLY: 'Quinzenal',
      QUARTERLY: 'Trimestral',
      SEMIANNUALLY: 'Semestral',
      ANNUALLY: 'Anual',
      CUSTOM: 'Personalizado',
    };
    return map[frequency] || frequency;
  }
}
