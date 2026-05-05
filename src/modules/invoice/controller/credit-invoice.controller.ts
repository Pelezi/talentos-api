import { Controller, Get, HttpStatus, Param, Patch, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { AuthenticatedRequest, RestrictedGuard } from '../../common';
import { CreditInvoiceData } from '../model';
import { CreditInvoiceService } from '../service';

@Controller('invoices')
@ApiTags('faturas')
@ApiBearerAuth()
@UseGuards(RestrictedGuard)
export class CreditInvoiceController {

    public constructor(private readonly creditInvoiceService: CreditInvoiceService) { }

    @Get('account/:accountId')
    @ApiOperation({ summary: 'Listar faturas de uma conta de crédito' })
    @ApiParam({ name: 'accountId', description: 'ID da conta de crédito' })
    @ApiResponse({ status: HttpStatus.OK, isArray: true, type: CreditInvoiceData })
    @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Conta não encontrada' })
    public async findByAccount(
        @Param('accountId') accountId: string,
        @Request() req: AuthenticatedRequest,
    ): Promise<CreditInvoiceData[]> {
        const userId = req.user?.userId ?? 0;
        return this.creditInvoiceService.findByAccount(parseInt(accountId), userId);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Buscar fatura por ID' })
    @ApiParam({ name: 'id', description: 'ID da fatura' })
    @ApiResponse({ status: HttpStatus.OK, type: CreditInvoiceData })
    @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Fatura não encontrada' })
    public async findById(
        @Param('id') id: string,
        @Request() req: AuthenticatedRequest,
    ): Promise<CreditInvoiceData> {
        const userId = req.user?.userId ?? 0;
        return this.creditInvoiceService.findById(parseInt(id), userId);
    }

    @Patch(':id/pay')
    @ApiOperation({ summary: 'Marcar fatura como paga' })
    @ApiParam({ name: 'id', description: 'ID da fatura' })
    @ApiResponse({ status: HttpStatus.OK, type: CreditInvoiceData })
    @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Fatura já está paga' })
    @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Fatura não encontrada' })
    public async markAsPaid(
        @Param('id') id: string,
        @Request() req: AuthenticatedRequest,
    ): Promise<CreditInvoiceData> {
        const userId = req.user?.userId ?? 0;
        return this.creditInvoiceService.markAsPaid(parseInt(id), userId);
    }
}
