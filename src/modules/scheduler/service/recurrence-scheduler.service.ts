import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/provider/prisma.provider';
import { RecurrenceFrequency } from '../../../generated/prisma/client';

@Injectable()
export class RecurrenceSchedulerService {
  private readonly logger = new Logger(RecurrenceSchedulerService.name);
  private isRunning = false;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cron job que roda todos os dias às 00:00
   * Para testar, você pode usar:
   * - @Cron('* * * * *') - Roda a cada minuto
   * - @Cron('0 * * * *') - Roda a cada hora
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleRecurrenceGeneration() {
    // Prevenir execuções concorrentes
    if (this.isRunning) {
      this.logger.warn('Scheduler já está em execução, pulando...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    
    this.logger.log('🔄 Iniciando geração automática de recorrências...');

    try {
      // Buscar todas as regras ACTIVE
      const activeRules = await this.prisma.recurrenceRule.findMany({
        where: {
          status: 'ACTIVE',
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              timezone: true,
            },
          },
        },
      });

      this.logger.log(`📋 Encontradas ${activeRules.length} regras ativas`);

      let processedCount = 0;
      let generatedCount = 0;
      let errorCount = 0;

      // Processar cada regra
      for (const rule of activeRules) {
        try {
          const generated = await this.processRule(rule);
          if (generated > 0) {
            processedCount++;
            generatedCount += generated;
            this.logger.log(
              `✅ Regra ${rule.id} (usuário ${rule.userId}): ${generated} ocorrência(s) gerada(s)`
            );
          }
        } catch (error) {
          errorCount++;
          const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
          const errorStack = error instanceof Error ? error.stack : undefined;
          this.logger.error(
            `❌ Erro ao processar regra ${rule.id}: ${errorMessage}`,
            errorStack
          );
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `✨ Processamento concluído em ${duration}ms - ` +
        `${processedCount} regras processadas, ` +
        `${generatedCount} ocorrências geradas, ` +
        `${errorCount} erros`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`💥 Erro crítico no scheduler: ${errorMessage}`, errorStack);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Processa uma regra de recorrência individual
   * Retorna o número de ocorrências geradas
   */
  private async processRule(rule: any): Promise<number> {
    // Verificar se deve gerar mais ocorrências
    const shouldGenerate = this.shouldGenerateMore(rule);
    if (!shouldGenerate) {
      return 0;
    }

    // Buscar transações existentes para determinar a próxima data
    const existingTransactions = await this.prisma.transaction.findMany({
      where: {
        recurrenceRuleId: rule.id,
      },
      orderBy: {
        date: 'desc',
      },
      take: 1,
    });

    let lastDate: Date;
    if (existingTransactions.length > 0) {
      lastDate = existingTransactions[0].date;
    } else {
      lastDate = rule.startDate;
    }

    // Calcular quantas ocorrências gerar
    const maxToGenerate = this.calculateHowManyToGenerate(rule);
    if (maxToGenerate === 0) {
      return 0;
    }

    // Gerar ocorrências
    const transactionsToCreate: any[] = [];
    let currentDate = lastDate;
    let generatedInThisBatch = 0;

    for (let i = 0; i < maxToGenerate; i++) {
      // Calcular próxima data
      currentDate = this.calculateNextDate(
        currentDate,
        rule.frequency,
        rule.interval,
        rule.dayOfMonth,
        rule.daysOfWeek
      );

      // Verificar se ultrapassou endDate
      if (rule.endDate && currentDate > rule.endDate) {
        break;
      }

      // Verificar se ultrapassou occurrenceCount
      if (
        rule.occurrenceCount &&
        rule.occurrenceGenerated + generatedInThisBatch + 1 > rule.occurrenceCount
      ) {
        break;
      }

      // Verificar se não está longe demais no futuro (limite de 1 ano)
      const oneYearFromNow = new Date();
      oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
      if (currentDate > oneYearFromNow) {
        break;
      }

      // Verificar se já existe transação com essa data e recorrenceIndex
      const existingTransaction = await this.prisma.transaction.findFirst({
        where: {
          recurrenceRuleId: rule.id,
          recurrenceIndex: rule.occurrenceGenerated + generatedInThisBatch,
        },
      });

      if (existingTransaction) {
        this.logger.warn(
          `Ocorrência já existe: regra ${rule.id}, index ${rule.occurrenceGenerated + generatedInThisBatch}`
        );
        continue;
      }

      // Buscar dados da primeira transação como template
      const templateTransaction = await this.prisma.transaction.findFirst({
        where: {
          recurrenceRuleId: rule.id,
        },
        orderBy: {
          date: 'asc',
        },
      });

      if (!templateTransaction) {
        this.logger.error(`Nenhuma transação template encontrada para regra ${rule.id}`);
        break;
      }

      // Criar transação
      transactionsToCreate.push({
        userId: rule.userId,
        groupId: rule.groupId,
        subcategoryId: templateTransaction.subcategoryId,
        accountId: templateTransaction.accountId,
        amount: templateTransaction.amount,
        title: templateTransaction.title,
        description: templateTransaction.description,
        date: currentDate.toISOString(),
        status: 'PENDING',
        recurrenceRuleId: rule.id,
        recurrenceIndex: rule.occurrenceGenerated + generatedInThisBatch,
      });

      generatedInThisBatch++;
    }

    // Criar todas as transações em uma única transação do banco
    if (transactionsToCreate.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        // Criar transações
        await tx.transaction.createMany({
          data: transactionsToCreate,
        });

        // Atualizar contador de ocorrências geradas
        await tx.recurrenceRule.update({
          where: { id: rule.id },
          data: {
            occurrenceGenerated: rule.occurrenceGenerated + generatedInThisBatch,
          },
        });

        // Se atingiu o limite, marcar como COMPLETED
        if (
          rule.occurrenceCount &&
          rule.occurrenceGenerated + generatedInThisBatch >= rule.occurrenceCount
        ) {
          await tx.recurrenceRule.update({
            where: { id: rule.id },
            data: { status: 'COMPLETED' },
          });
        }
      });
    }

    return generatedInThisBatch;
  }

  /**
   * Verifica se deve gerar mais ocorrências para uma regra
   */
  private shouldGenerateMore(rule: any): boolean {
    // Se não está ativa, não gerar
    if (rule.status !== 'ACTIVE') {
      return false;
    }

    // Se tem endDate e já passou, não gerar
    if (rule.endDate && new Date() > rule.endDate) {
      return false;
    }

    // Se tem occurrenceCount e já atingiu, não gerar
    if (rule.occurrenceCount && rule.occurrenceGenerated >= rule.occurrenceCount) {
      return false;
    }

    return true;
  }

  /**
   * Calcula quantas ocorrências gerar de uma vez
   * Gera até ter pelo menos 30 dias de antecedência
   */
  private calculateHowManyToGenerate(rule: any): number {
    // Se tem menos de 5 ocorrências geradas, gerar mais 12
    if (rule.occurrenceGenerated < 5) {
      return 12;
    }

    // Caso contrário, gerar 6 por vez
    return 6;
  }

  /**
   * Calcula a próxima data de ocorrência baseada na frequência
   */
  private calculateNextDate(
    currentDate: Date,
    frequency: RecurrenceFrequency,
    interval: number,
    dayOfMonth?: number,
    daysOfWeek?: string
  ): Date {
    const nextDate = new Date(currentDate);

    switch (frequency) {
      case 'DAILY':
        nextDate.setDate(nextDate.getDate() + interval);
        break;

      case 'WEEKLY':
        if (daysOfWeek) {
          const days = daysOfWeek.split(',').map(Number).sort();
          const currentDay = nextDate.getDay();
          let nextDay = days.find((d) => d > currentDay);

          if (!nextDay) {
            nextDay = days[0];
            nextDate.setDate(nextDate.getDate() + 7 * interval);
          }

          const daysToAdd = nextDay - currentDay;
          nextDate.setDate(nextDate.getDate() + daysToAdd);
        } else {
          nextDate.setDate(nextDate.getDate() + 7 * interval);
        }
        break;

      case 'BIWEEKLY':
        nextDate.setDate(nextDate.getDate() + 14 * interval);
        break;

      case 'MONTHLY':
        nextDate.setMonth(nextDate.getMonth() + interval);
        if (dayOfMonth) {
          nextDate.setDate(Math.min(dayOfMonth, this.getLastDayOfMonth(nextDate)));
        }
        break;

      case 'QUARTERLY':
        nextDate.setMonth(nextDate.getMonth() + 3 * interval);
        break;

      case 'SEMIANNUALLY':
        nextDate.setMonth(nextDate.getMonth() + 6 * interval);
        break;

      case 'ANNUALLY':
        nextDate.setFullYear(nextDate.getFullYear() + interval);
        break;

      default:
        break;
    }

    return nextDate;
  }

  /**
   * Retorna o último dia do mês de uma data
   */
  private getLastDayOfMonth(date: Date): number {
    const year = date.getFullYear();
    const month = date.getMonth();
    return new Date(year, month + 1, 0).getDate();
  }

  /**
   * Método manual para forçar execução (útil para testes)
   */
  async forceRun() {
    this.logger.log('🔧 Execução manual do scheduler solicitada');
    await this.handleRecurrenceGeneration();
  }
}
