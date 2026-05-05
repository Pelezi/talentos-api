import { Module } from '@nestjs/common';
import { RecurrenceSchedulerService } from './service/recurrence-scheduler.service';
import { CommonModule } from '../common';

@Module({
  imports: [CommonModule],
  providers: [RecurrenceSchedulerService],
  exports: [RecurrenceSchedulerService],
})
export class SchedulerModule {}
