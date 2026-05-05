import { InstallmentPlanStatus } from '../../../generated/prisma/client';

/**
 * DTO para criar um plano de parcelamento
 * Recebe: valor total original, número de parcelas, taxa de juros
 */
export class CreateInstallmentPlanInput {
  totalAmount: number; // Valor original antes de juros
  installmentCount: number; // Número de parcelas (mínimo 2)
  interestRate: number; // Taxa de juros em % (0-100)
  groupId?: number; // Grupo (opcional)

  constructor(input: Partial<CreateInstallmentPlanInput>) {
    this.totalAmount = input.totalAmount ?? 0;
    this.installmentCount = input.installmentCount ?? 2;
    this.interestRate = input.interestRate ?? 0;
    this.groupId = input.groupId;
  }
}

/**
 * DTO para criar uma transação parcelada (inclui dados da transação base)
 * Adiciona informações de parcelamento ao CreateTransactionInput
 */
export class CreateInstallmentTransactionInput {
  // Dados base da transação
  subcategoryId?: number;
  accountId: number;
  title?: string;
  amount: number; // Este será o totalAmount do parcelamento
  description?: string;
  date: Date; // Data da primeira parcela
  type: 'EXPENSE' | 'INCOME';
  groupId?: number;

  // Dados de parcelamento
  installmentCount: number; // Número de parcelas
  interestRate: number; // Taxa de juros em %

  // Opcional: taxa sobre o parcelamento
  feeAmount?: number;
  feeAccountId?: number;

  // Status das parcelas
  isPending?: boolean; // Se true, todas as parcelas ficam pendentes
  firstInstallmentConfirmed?: boolean; // Se true (e isPending=true), a primeira parcela é confirmada

  constructor(input: Partial<CreateInstallmentTransactionInput>) {
    this.subcategoryId = input.subcategoryId;
    this.accountId = input.accountId ?? 0;
    this.title = input.title;
    this.amount = input.amount ?? 0;
    this.description = input.description;
    this.date = input.date ?? new Date();
    this.type = input.type ?? 'EXPENSE';
    this.groupId = input.groupId;
    this.installmentCount = input.installmentCount ?? 2;
    this.interestRate = input.interestRate ?? 0;
    this.feeAmount = input.feeAmount;
    this.feeAccountId = input.feeAccountId;
    this.isPending = input.isPending;
    this.firstInstallmentConfirmed = input.firstInstallmentConfirmed;
  }
}

/**
 * DTO para atualizar um plano de parcelamento existente
 * Permite alterar valor, parcelas, juros, título, descrição, conta, categoria
 * Qualquer mudança em valor/parcelas/juros recalcula os valores das parcelas pendentes
 */
export class UpdateInstallmentPlanInput {
  // Campos financeiros (alteram recalculam amountPerInstallment para parcelas pendentes)
  totalAmount?: number;       // Novo valor total original (antes de juros)
  installmentCount?: number;  // Novo número de parcelas
  interestRate?: number;      // Nova taxa de juros (%)

  // Campos descritivos (propagam para transações pendentes)
  title?: string;
  description?: string;
  subcategoryId?: number;
  accountId?: number;

  // Taxa do parcelamento — vira um novo plano de parcelamento de taxa separado
  feeAmount?: number;
  feeAccountId?: number;

  // Mudar status do plano
  status?: InstallmentPlanStatus;

  // Quando informado, atualiza apenas transações com recurrenceIndex >= esse valor
  fromRecurrenceIndex?: number;

  constructor(input: Partial<UpdateInstallmentPlanInput>) {
    this.totalAmount = input.totalAmount;
    this.installmentCount = input.installmentCount;
    this.interestRate = input.interestRate;
    this.title = input.title;
    this.description = input.description;
    this.subcategoryId = input.subcategoryId;
    this.accountId = input.accountId;
    this.feeAmount = input.feeAmount;
    this.feeAccountId = input.feeAccountId;
    this.status = input.status;
    this.fromRecurrenceIndex = input.fromRecurrenceIndex;
  }
}
