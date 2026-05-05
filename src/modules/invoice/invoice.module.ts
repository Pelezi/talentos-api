import { Module } from '@nestjs/common';
import { CommonModule } from '../common';
import { CreditInvoiceController } from './controller';
import { CreditInvoiceService } from './service';
import { InvoiceSchedulerService } from './service/invoice-scheduler.service';

@Module({
    imports: [CommonModule],
    providers: [CreditInvoiceService, InvoiceSchedulerService],
    controllers: [CreditInvoiceController],
    exports: [CreditInvoiceService],
})
export class InvoiceModule { }
