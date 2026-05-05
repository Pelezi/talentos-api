import { RecurrenceRule, RecurrenceFrequency, RecurrenceRuleStatus, Transaction, TransactionStatus } from '../../../generated/prisma/client';

/**
 * DTO de resposta para RecurrenceRule com informações calculadas
 * Inclui lista de transações geradas e estatísticas
 */
export class RecurrenceRuleData {
  id: number;
  userId: number;
  groupId?: number;
  frequency: RecurrenceFrequency;
  interval: number;
  daysOfWeek?: string;
  dayOfMonth?: number;
  startDate: Date;
  endDate?: Date;
  occurrenceCount?: number;
  occurrenceGenerated: number;
  status: RecurrenceRuleStatus;
  createdAt: Date;
  updatedAt: Date;

  // Relacionamentos
  transactions?: RecurrenceTransactionSummary[];

  // Estatísticas
  totalConfirmed?: number;
  totalPending?: number;
  remainingOccurrences?: number; // Quantas faltam (se occurrenceCount definido)
  nextOccurrenceDate?: Date; // Próxima data prevista
  isComplete?: boolean; // Já atingiu limite?

  constructor(rule: RecurrenceRule & { transactions?: Transaction[] }) {
    this.id = rule.id;
    this.userId = rule.userId;
    this.groupId = rule.groupId ?? undefined;
    this.frequency = rule.frequency;
    this.interval = rule.interval;
    this.daysOfWeek = rule.daysOfWeek ?? undefined;
    this.dayOfMonth = rule.dayOfMonth ?? undefined;
    this.startDate = rule.startDate;
    this.endDate = rule.endDate ?? undefined;
    this.occurrenceCount = rule.occurrenceCount ?? undefined;
    this.occurrenceGenerated = rule.occurrenceGenerated;
    this.status = rule.status;
    this.createdAt = rule.createdAt;
    this.updatedAt = rule.updatedAt;

    // Carregar transações se fornecidas
    if (rule.transactions) {
      this.transactions = rule.transactions.map(
        (t) => new RecurrenceTransactionSummary(t)
      );

      // Calcular estatísticas
      this.totalConfirmed = this.transactions.filter(
        (t) => t.status === 'CONFIRMED'
      ).length;
      this.totalPending = this.transactions.filter(
        (t) => t.status === 'PENDING'
      ).length;

      // Calcular ocorrências restantes
      if (this.occurrenceCount) {
        this.remainingOccurrences =
          this.occurrenceCount - this.occurrenceGenerated;
      }

      // Calcular próxima data
      if (this.occurrenceGenerated < (this.occurrenceCount ?? Infinity)) {
        this.nextOccurrenceDate = this.calculateNextDate(
          rule.startDate,
          rule.frequency,
          rule.interval,
          this.occurrenceGenerated
        );
      }

      // Verificar se está completa
      this.isComplete =
        (this.occurrenceCount !== null && this.occurrenceCount !== undefined &&
          this.occurrenceGenerated >= this.occurrenceCount) ||
        (this.endDate !== null && this.endDate !== undefined && new Date() > this.endDate);
    }
  }

  /**
   * Calcula a próxima data de ocorrência baseada no índice
   */
  private calculateNextDate(
    startDate: Date,
    frequency: RecurrenceFrequency,
    interval: number,
    index: number
  ): Date {
    const date = new Date(startDate);

    switch (frequency) {
      case 'DAILY':
        date.setDate(date.getDate() + index * interval);
        break;

      case 'WEEKLY':
      case 'BIWEEKLY': {
        const weekMultiplier = frequency === 'BIWEEKLY' ? 2 : 1;
        date.setDate(date.getDate() + index * interval * 7 * weekMultiplier);
        break;
      }

      case 'MONTHLY':
      case 'QUARTERLY':
      case 'SEMIANNUALLY': {
        const monthsMap = { MONTHLY: 1, QUARTERLY: 3, SEMIANNUALLY: 6 };
        const months = monthsMap[frequency] * index * interval;
        const ref = new Date(date.getFullYear(), date.getMonth() + months, 1);
        const lastDay = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
        return new Date(ref.getFullYear(), ref.getMonth(), Math.min(date.getDate(), lastDay));
      }

      case 'ANNUALLY': {
        const targetYear = date.getFullYear() + index * interval;
        const lastDay = new Date(targetYear, date.getMonth() + 1, 0).getDate();
        return new Date(targetYear, date.getMonth(), Math.min(date.getDate(), lastDay));
      }

      default:
        break;
    }

    return date;
  }
}

/**
 * Resumo de transação recorrente
 * Similar ao TransactionSummary do InstallmentPlan
 */
export class RecurrenceTransactionSummary {
  id: number;
  title?: string;
  description?: string;
  amount: number;
  date: Date;
  status: TransactionStatus;
  confirmedAt?: Date;
  recurrenceIndex?: number; // Índice da ocorrência (0-based)
  subcategoryId?: number;
  accountId?: number;

  constructor(transaction: Transaction) {
    this.id = transaction.id;
    this.title = transaction.title ?? undefined;
    this.description = transaction.description ?? undefined;
    this.amount = parseFloat(transaction.amount.toString());
    this.date = transaction.date;
    this.status = transaction.status;
    this.confirmedAt = transaction.confirmedAt ?? undefined;
    this.recurrenceIndex = transaction.recurrenceIndex ?? undefined;
    this.subcategoryId = transaction.subcategoryId ?? undefined;
    this.accountId = transaction.accountId ?? undefined;
  }
}
