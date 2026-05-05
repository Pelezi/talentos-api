import { RecurrenceFrequency, RecurrenceRuleStatus } from '../../../generated/prisma/client';

/**
 * DTO para criar uma regra de recorrência
 */
export class CreateRecurrenceRuleInput {
  frequency: RecurrenceFrequency; // DAILY, WEEKLY, MONTHLY, etc
  interval?: number; // A cada X unidades (default: 1)
  daysOfWeek?: string; // "1,3,5" para SEG,QUA,SEX (se WEEKLY) ou dia único (se MONTHLY por semana)
  dayOfMonth?: number; // Dia específico 1-31 (se MONTHLY por data)
  weekOfMonth?: number; // Semana do mês: 1-4 ou -1 (última) (se MONTHLY por dia da semana)
  startDate: Date; // Primeira ocorrência
  endDate?: Date; // Última data (NULL = indefinida)
  occurrenceCount?: number; // Máximo de ocorrências (NULL = indefinido)
  groupId?: number;

  constructor(input: Partial<CreateRecurrenceRuleInput>) {
    this.frequency = input.frequency ?? 'MONTHLY';
    this.interval = input.interval ?? 1;
    this.daysOfWeek = input.daysOfWeek;
    this.dayOfMonth = input.dayOfMonth;
    this.weekOfMonth = input.weekOfMonth;
    this.startDate = input.startDate ?? new Date();
    this.endDate = input.endDate;
    this.occurrenceCount = input.occurrenceCount;
    this.groupId = input.groupId;
  }
}

/**
 * DTO para criar uma transação recorrente
 * Combina dados da transação base + regra de recorrência
 */
export class CreateRecurrenceTransactionInput {
  // Dados base da transação
  subcategoryId?: number;
  accountId: number;
  title?: string;
  amount: number;
  description?: string;
  type: 'EXPENSE' | 'INCOME';
  groupId?: number;

  // Regra de recorrência
  frequency: RecurrenceFrequency;
  interval?: number; // Default: 1
  daysOfWeek?: string; // "1,3,5" para WEEKLY; dia único para MONTHLY por semana
  dayOfMonth?: number; // 1-31 para MONTHLY por data
  weekOfMonth?: number; // 1-4 ou -1 (última) para MONTHLY por dia da semana
  startDate: string; // Primeira ocorrência (YYYY-MM-DD)
  endDate?: string; // Data final (NULL = indefinida) (YYYY-MM-DD)
  occurrenceCount?: number; // Máximo de ocorrências

  // Quantas transações gerar inicialmente? (default: 12)
  initialGenerationCount?: number;

  // Taxa (opcional)
  feeAmount?: number;
  feeAccountId?: number;

  constructor(input: Partial<CreateRecurrenceTransactionInput>) {
    this.subcategoryId = input.subcategoryId;
    this.accountId = input.accountId ?? 0;
    this.title = input.title;
    this.amount = input.amount ?? 0;
    this.description = input.description;
    this.type = input.type ?? 'EXPENSE';
    this.groupId = input.groupId;
    this.frequency = input.frequency ?? 'MONTHLY';
    this.interval = input.interval ?? 1;
    this.daysOfWeek = input.daysOfWeek;
    this.dayOfMonth = input.dayOfMonth;
    this.weekOfMonth = input.weekOfMonth;
    this.startDate = input.startDate ?? '';
    this.endDate = input.endDate;
    this.occurrenceCount = input.occurrenceCount;
    this.initialGenerationCount = input.initialGenerationCount ?? 12;
    this.feeAmount = input.feeAmount;
    this.feeAccountId = input.feeAccountId;
  }
}

/**
 * DTO para atualizar regra de recorrência
 * Pode alterar data de término, pausar, etc.
 * Campos de conteúdo (amount, title, etc.) atualizam as transações PENDENTES vinculadas.
 */
export class UpdateRecurrenceRuleInput {
  status?: RecurrenceRuleStatus; // ACTIVE, PAUSED, CANCELLED
  endDate?: Date; // Mudar data de término
  occurrenceCount?: number; // Mudar limite de ocorrências

  // Campos de conteúdo — quando informados, atualizam todas as transações PENDING da regra
  amount?: number;
  title?: string;
  description?: string;
  subcategoryId?: number;
  accountId?: number;

  // Quando informado, atualiza apenas transações com recurrenceIndex >= esse valor
  fromRecurrenceIndex?: number;

  constructor(input: Partial<UpdateRecurrenceRuleInput>) {
    this.status = input.status;
    this.endDate = input.endDate;
    this.occurrenceCount = input.occurrenceCount;
    this.amount = input.amount;
    this.title = input.title;
    this.description = input.description;
    this.subcategoryId = input.subcategoryId;
    this.accountId = input.accountId;
    this.fromRecurrenceIndex = input.fromRecurrenceIndex;
  }
}

/**
 * DTO para gerar próximas ocorrências de uma regra
 */
export class GenerateOccurrencesInput {
  count?: number; // Quantas gerar (default: 12)
  generateFeeTransactions?: boolean; // Gerar taxa nas transações? (default: false, pois já existe na primeira)

  constructor(input: Partial<GenerateOccurrencesInput>) {
    this.count = input.count ?? 12;
    this.generateFeeTransactions = input.generateFeeTransactions ?? false;
  }
}
