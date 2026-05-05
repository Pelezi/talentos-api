import { Module } from '@nestjs/common';
import { InstallmentService } from './service/installment.service';
import { InstallmentController } from './controller/installment.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [InstallmentController],
  providers: [InstallmentService],
  exports: [InstallmentService],
})
export class InstallmentModule {}
