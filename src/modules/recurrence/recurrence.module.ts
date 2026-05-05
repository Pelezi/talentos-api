import { Module } from '@nestjs/common';
import { RecurrenceService } from './service/recurrence.service';
import { RecurrenceController } from './controller/recurrence.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [RecurrenceController],
  providers: [RecurrenceService],
  exports: [RecurrenceService],
})
export class RecurrenceModule {}
