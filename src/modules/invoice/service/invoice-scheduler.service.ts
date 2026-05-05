import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common';

@Injectable()
export class InvoiceSchedulerService {
  private readonly logger = new Logger(InvoiceSchedulerService.name);

  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Close invoices that have passed their due date
   * Runs every day at 1 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async closeExpiredInvoices(): Promise<void> {
    try {
      const now = new Date();

      const overdueBaseWhere = {
        status: 'OPEN',
        dueDate: {
          lte: now,
        },
      };

      const overdueCount = await (this.prismaService as any).creditInvoice.count({
        where: overdueBaseWhere,
      });

      if (overdueCount === 0) {
        this.logger.debug('No expired invoices to process');
        return;
      }

      // If invoice is overdue and has no outstanding amount, consider it PAID.
      const paidResult = await (this.prismaService as any).creditInvoice.updateMany({
        where: {
          ...overdueBaseWhere,
          totalAmount: { lte: 0 },
        },
        data: {
          status: 'PAID',
        },
      });

      // Otherwise, close and await payment.
      const closedResult = await (this.prismaService as any).creditInvoice.updateMany({
        where: {
          ...overdueBaseWhere,
          totalAmount: { gt: 0 },
        },
        data: {
          status: 'CLOSED',
        },
      });

      this.logger.log(`Processed expired invoices: ${closedResult.count} CLOSED, ${paidResult.count} PAID`);
    } catch (error) {
      this.logger.error('Error closing expired invoices', error);
    }
  }

  /**
   * Manual trigger to close invoices (for testing or manual jobs)
   */
  async closeExpiredInvoicesManually(): Promise<{ count: number }> {
    const now = new Date();

    const overdueBaseWhere = {
      status: 'OPEN',
      dueDate: {
        lte: now,
      },
    };

    const paidResult = await (this.prismaService as any).creditInvoice.updateMany({
      where: {
        ...overdueBaseWhere,
        totalAmount: { lte: 0 },
      },
      data: {
        status: 'PAID',
      },
    });

    const closedResult = await (this.prismaService as any).creditInvoice.updateMany({
      where: {
        ...overdueBaseWhere,
        totalAmount: { gt: 0 },
      },
      data: {
        status: 'CLOSED',
      },
    });

    const total = closedResult.count + paidResult.count;
    this.logger.log(`Manually processed expired invoices: ${closedResult.count} CLOSED, ${paidResult.count} PAID`);
    return { count: total };
  }
}
