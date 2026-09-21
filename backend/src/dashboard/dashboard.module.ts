import { Module } from '@nestjs/common';
import { ContractsModule } from '../contracts/contracts.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [ContractsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
