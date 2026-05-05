import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../common';
import { CreditInvoiceData } from '../model';

@Injectable()
export class CreditInvoiceService {

    public constructor(private readonly prismaService: PrismaService) { }

    /**
     * List all credit invoices for a given account.
     */
    public async findByAccount(accountId: number, userId: number): Promise<CreditInvoiceData[]> {
        // Verify access
        const account = await this.prismaService.account.findFirst({
            where: {
                id: accountId,
                OR: [
                    { userId },
                    { group: { members: { some: { userId } } } },
                ],
            },
        });

        if (!account) {
            throw new HttpException('Conta não encontrada', HttpStatus.NOT_FOUND);
        }

        const invoices = await (this.prismaService as any).creditInvoice.findMany({
            where: { accountId },
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
        });

        return invoices.map((i: any) => new CreditInvoiceData(i));
    }

    /**
     * Get a single credit invoice by ID.
     */
    public async findById(invoiceId: number, userId: number): Promise<CreditInvoiceData> {
        const invoice = await (this.prismaService as any).creditInvoice.findFirst({
            where: {
                id: invoiceId,
                OR: [
                    { userId },
                    { group: { members: { some: { userId } } } },
                ],
            },
        });

        if (!invoice) {
            throw new HttpException('Fatura não encontrada', HttpStatus.NOT_FOUND);
        }

        return new CreditInvoiceData(invoice);
    }

    /**
     * Mark a credit invoice as PAID (transitions CLOSED → PAID).
     * Also confirms the linked PENDING transfer transaction so the CASH account balance is updated.
     */
    public async markAsPaid(invoiceId: number, userId: number): Promise<CreditInvoiceData> {
        const invoice = await this.findById(invoiceId, userId);

        if (invoice.status === 'PAID') {
            throw new HttpException('Fatura já está paga', HttpStatus.BAD_REQUEST);
        }

        if (invoice.status !== 'CLOSED') {
            throw new HttpException('Apenas faturas fechadas podem ser marcadas como pagas', HttpStatus.BAD_REQUEST);
        }

        // Confirm the linked PENDING transfer so the CASH account balance is debited
        if (invoice.transactionId) {
            await this.prismaService.transaction.updateMany({
                where: { id: invoice.transactionId, status: 'PENDING' },
                data: { status: 'CONFIRMED' },
            });
        }

        const updated = await (this.prismaService as any).creditInvoice.update({
            where: { id: invoiceId },
            data: { status: 'PAID' },
        });

        return new CreditInvoiceData(updated);
    }
}
