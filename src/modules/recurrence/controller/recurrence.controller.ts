import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { RecurrenceService } from '../service/recurrence.service';
import { RestrictedGuard, AuthenticatedRequest } from '../../common';
import {
  CreateRecurrenceRuleInput,
  CreateRecurrenceTransactionInput,
  GenerateOccurrencesInput,
  UpdateRecurrenceRuleInput,
} from '../model/recurrence-rule.input';
import { RecurrenceRuleData } from '../model/recurrence-rule.data';

@Controller('recurrence-rules')
@UseGuards(RestrictedGuard)
export class RecurrenceController {
  constructor(private readonly recurrenceService: RecurrenceService) {}

  /**
   * GET /recurrence-rules
   * Lista todas as regras de recorrência do usuário (ou do grupo se groupId fornecido)
   */
  @Get()
  async findAll(
    @Request() request: AuthenticatedRequest,
    @Query('groupId') groupId?: string
  ): Promise<RecurrenceRuleData[]> {
    return this.recurrenceService.findByUser(
      request.user!.userId,
      groupId ? parseInt(groupId) : undefined
    );
  }

  /**
   * GET /recurrence-rules/:id
   * Busca uma regra específica com detalhes
   */
  @Get(':id')
  async findOne(
    @Request() request: AuthenticatedRequest,
    @Param('id') id: number
  ): Promise<RecurrenceRuleData> {
    return this.recurrenceService.findById(request.user!.userId, id);
  }

  /**
   * POST /recurrence-rules
   * Cria uma regra de recorrência sem transações (para preview)
   */
  @Post()
  async create(
    @Request() request: AuthenticatedRequest,
    @Body() input: CreateRecurrenceRuleInput
  ): Promise<RecurrenceRuleData> {
    return this.recurrenceService.createRule(request.user!.userId, input);
  }

  /**
   * POST /recurrence-rules/transaction
   * Cria uma regra de recorrência COM transações geradas
   * Esta é a rota principal para criar transações recorrentes
   */
  @Post('transaction')
  async createWithTransaction(
    @Request() request: AuthenticatedRequest,
    @Body() input: CreateRecurrenceTransactionInput
  ): Promise<RecurrenceRuleData> {
    return this.recurrenceService.createRecurrenceTransaction(request.user!.userId, input);
  }

  /**
   * PUT /recurrence-rules/:id
   * Atualiza uma regra de recorrência
   * Pode alterar status (pausar, cancelar) ou limites
   */
  @Put(':id')
  async update(
    @Request() request: AuthenticatedRequest,
    @Param('id') id: number,
    @Body() input: UpdateRecurrenceRuleInput
  ): Promise<RecurrenceRuleData> {
    return this.recurrenceService.update(request.user!.userId, id, input);
  }

  /**
   * POST /recurrence-rules/:id/generate
   * Gera mais ocorrências de uma regra existente
   */
  @Post(':id/generate')
  async generateOccurrences(
    @Request() request: AuthenticatedRequest,
    @Param('id') id: number,
    @Body() input: GenerateOccurrencesInput
  ): Promise<RecurrenceRuleData> {
    return this.recurrenceService.generateOccurrences(request.user!.userId, id, input);
  }

  /**
   * DELETE /recurrence-rules/:id
   * Cancela uma regra de recorrência
   * Query param deleteTransactions=true para deletar TODAS as transações
   * Padrão: mantém transações confirmadas, remove apenas pendentes
   */
  @Delete(':id')
  async cancel(
    @Request() request: AuthenticatedRequest,
    @Param('id') id: number,
    @Query('deleteTransactions') deleteTransactions?: string
  ): Promise<{ message: string }> {
    const shouldDelete = deleteTransactions === 'true';
    await this.recurrenceService.cancel(request.user!.userId, id, shouldDelete);
    return {
      message: shouldDelete
        ? 'Regra e transações deletadas'
        : 'Regra cancelada, transações pendentes removidas',
    };
  }

  /**
   * PUT /recurrence-rules/:id/occurrences/:transactionId/confirm
   * Confirma uma ocorrência específica
   */
  @Put(':id/occurrences/:transactionId/confirm')
  async confirmOccurrence(
    @Request() request: AuthenticatedRequest,
    @Param('transactionId') transactionId: number
  ): Promise<{ message: string }> {
    await this.recurrenceService.confirmOccurrence(request.user!.userId, transactionId);
    return { message: 'Ocorrência confirmada' };
  }
}
