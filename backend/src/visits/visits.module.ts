import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module.js';
import { ChecklistTemplatesModule } from '../checklist-templates/checklist-templates.module.js';
import { EmailModule } from '../email/email.module.js';
import { VisitsService } from './visits.service.js';
import { VisitsController } from './visits.controller.js';
import { VisitReportService } from './visit-report.service.js';

@Module({
  imports: [TicketsModule, ChecklistTemplatesModule, EmailModule],
  providers: [VisitsService, VisitReportService],
  controllers: [VisitsController],
  exports: [VisitsService],
})
export class VisitsModule {}
