import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { CommonModule } from './common';
import { UserModule } from './user/user.module';
import { CategoryModule } from './category/category.module';
import { SubcategoryModule } from './subcategory/subcategory.module';
import { BudgetModule } from './budget/budget.module';
import { TransactionModule } from './transaction/transaction.module';
import { ExpenseModule } from './expense/expense.module';
import { GroupModule } from './group/group.module';
import { NotificationModule } from './notification/notification.module';
import { AccountModule } from './account/account.module';
import { InstallmentModule } from './installment/installment.module';
import { RecurrenceModule } from './recurrence/recurrence.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { InvoiceModule } from './invoice/invoice.module';

@Module({
    imports: [
        ScheduleModule.forRoot(),
        CommonModule,
        UserModule,
        CategoryModule,
        SubcategoryModule,
        BudgetModule,
        TransactionModule,
        ExpenseModule,
        GroupModule,
        NotificationModule,
        AccountModule,
        InstallmentModule,
        RecurrenceModule,
        SchedulerModule,
        InvoiceModule,
    ]
})
export class ApplicationModule {}
