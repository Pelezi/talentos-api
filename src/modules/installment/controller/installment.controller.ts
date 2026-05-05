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
import { InstallmentService } from '../service/installment.service';
import { RestrictedGuard, AuthenticatedRequest } from '../../common';
import {
  CreateInstallmentPlanInput,
  CreateInstallmentTransactionInput,
  UpdateInstallmentPlanInput,
} from '../model/installment-plan.input';
import { InstallmentPlanData } from '../model/installment-plan.data';

@Controller('installment-plans')
@UseGuards(RestrictedGuard)
export class InstallmentController {
  constructor(private readonly installmentService: InstallmentService) {}

  /**
   * GET /installment-plans
   * Lista todos os planos de parcelamento do usuário (ou do grupo se groupId fornecido)
   */
  @Get()
  async findAll(
    @Request() request: AuthenticatedRequest,
    @Query('groupId') groupId?: string
  ): Promise<InstallmentPlanData[]> {
    return this.installmentService.findByUser(
      request.user!.userId,
      groupId ? parseInt(groupId) : undefined
    );
  }

  /**
   * GET /installment-plans/:id
   * Busca um plano específico com detalhes
   */
  @Get(':id')
  async findOne(
    @Request() request: AuthenticatedRequest,
    @Param('id') id: number
  ): Promise<InstallmentPlanData> {
    return this.installmentService.findById(request.user!.userId, id);
  }

  /**
   * POST /installment-plans
   * Cria um plano de parcelamento sem transações (para preview)
   */
  @Post()
  async create(
    @Request() request: AuthenticatedRequest,
    @Body() input: CreateInstallmentPlanInput
  ): Promise<InstallmentPlanData> {
    return this.installmentService.createPlan(request.user!.userId, input);
  }

  /**
   * POST /installment-plans/transaction
   * Cria um plano de parcelamento COM transações associadas
   * Esta é a rota principal para criar transações parceladas
   */
  @Post('transaction')
  async createWithTransaction(
    @Request() request: AuthenticatedRequest,
    @Body() input: CreateInstallmentTransactionInput
  ): Promise<InstallmentPlanData> {
    return this.installmentService.createInstallmentTransaction(request.user!.userId, input);
  }

  /**
   * PUT /installment-plans/:id
   * Atualiza um plano de parcelamento
   * Pode alterar taxa de juros (recalcula parcelas pendentes)
   */
  @Put(':id')
  async update(
    @Request() request: AuthenticatedRequest,
    @Param('id') id: number,
    @Body() input: UpdateInstallmentPlanInput
  ): Promise<InstallmentPlanData> {
    return this.installmentService.update(request.user!.userId, id, input);
  }

  /**
   * DELETE /installment-plans/:id
   * Cancela um plano de parcelamento
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
    await this.installmentService.cancel(request.user!.userId, id, shouldDelete);
    return {
      message: shouldDelete
        ? 'Plano e transações deletados'
        : 'Plano cancelado, transações pendentes removidas',
    };
  }

  /**
   * PUT /installment-plans/:id/installments/:transactionId/confirm
   * Confirma uma parcela específica
   */
  @Put(':id/installments/:transactionId/confirm')
  async confirmInstallment(
    @Request() request: AuthenticatedRequest,
    @Param('transactionId') transactionId: number
  ): Promise<{ message: string }> {
    await this.installmentService.confirmInstallment(request.user!.userId, transactionId);
    return { message: 'Parcela confirmada' };
  }
}
