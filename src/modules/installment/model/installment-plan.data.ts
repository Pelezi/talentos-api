import { InstallmentPlan, InstallmentPlanStatus, Transaction, TransactionStatus } from '../../../generated/prisma/client';

/**
 * DTO de resposta para InstallmentPlan com informações calculadas
 * Inclui lista de transações parceladas e estatísticas
 */
export class InstallmentPlanData {
  id: number;
  userId: number;
  groupId?: number;
  totalAmount: number; // Valor original
  interestRate: number; // Taxa de juros %
  totalWithInterest: number; // Total com juros aplicados
  installmentCount: number; // Número total de parcelas
  amountPerInstallment: number; // Valor de cada parcela
  status: InstallmentPlanStatus;
  createdAt: Date;
  updatedAt: Date;

  // Relacionamentos
  transactions?: TransactionSummary[]; // Transações do plano

  // Estatísticas calculadas
  confirmedCount?: number; // Quantas parcelas foram confirmadas
  pendingCount?: number; // Quantas ainda são pendentes
  totalPaid?: number; // Total já pago (confirmado)
  totalRemaining?: number; // Total restante

  constructor(plan: InstallmentPlan & { transactions?: Transaction[] }) {
    this.id = plan.id;
    this.userId = plan.userId;
    this.groupId = plan.groupId ?? undefined;
    this.totalAmount = parseFloat(plan.totalAmount.toString());
    this.interestRate = parseFloat(plan.interestRate.toString());
    this.totalWithInterest = parseFloat(plan.totalWithInterest.toString());
    this.installmentCount = plan.installmentCount;
    this.amountPerInstallment = parseFloat(plan.amountPerInstallment.toString());
    this.status = plan.status;
    this.createdAt = plan.createdAt;
    this.updatedAt = plan.updatedAt;

    // Carregar transações se fornecidas
    if (plan.transactions) {
      this.transactions = plan.transactions.map(
        (t) => new TransactionSummary(t)
      );

      // Calcular estatísticas
      this.confirmedCount = this.transactions.filter(
        (t) => t.status === 'CONFIRMED'
      ).length;
      this.pendingCount = this.transactions.filter(
        (t) => t.status === 'PENDING'
      ).length;
      this.totalPaid = this.transactions
        .filter((t) => {
          if (t.status !== 'CONFIRMED') return false;
          // Only count as paid if the date is in the past or today
          return new Date(t.date) <= new Date();
        })
        .reduce((sum, t) => sum + t.amount, 0);
      this.totalRemaining = this.transactions
        .filter((t) => {
          // Pending transactions are always remaining
          if (t.status === 'PENDING') return true;
          // Confirmed transactions with future dates are remaining
          if (t.status === 'CONFIRMED' && new Date(t.date) > new Date()) return true;
          return false;
        })
        .reduce((sum, t) => sum + t.amount, 0);
    }
  }
}

/**
 * Resumo de transação para incluir no InstallmentPlanData
 * Não carrega todos os relacionamentos, apenas dados essenciais
 */
export class TransactionSummary {
  id: number;
  title?: string;
  amount: number;
  date: Date;
  status: TransactionStatus;
  confirmedAt?: Date;
  recurrenceIndex?: number; // Qual parcela é esta (0-based)
  subcategoryId?: number;
  accountId?: number;
  description?: string;

  constructor(transaction: Transaction) {
    this.id = transaction.id;
    this.title = transaction.title ?? undefined;
    this.amount = parseFloat(transaction.amount.toString());
    this.date = transaction.date;
    this.status = transaction.status;
    this.confirmedAt = transaction.confirmedAt ?? undefined;
    this.recurrenceIndex = transaction.recurrenceIndex ?? undefined;
    this.subcategoryId = transaction.subcategoryId ?? undefined;
    this.accountId = transaction.accountId ?? undefined;
    this.description = transaction.description ?? undefined;
  }
}
