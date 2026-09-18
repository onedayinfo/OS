import { Module } from '@nestjs/common';
import { SlaModule } from '../sla/sla.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ContractsModule } from '../contracts/contracts.module.js';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';
import { TicketNumberService } from './ticket-number.service.js';
import { TicketEventsService } from './ticket-events.service.js';
import { TicketStatusService } from './ticket-status.service.js';

@Module({
  imports: [SlaModule, NotificationsModule, ContractsModule],
  controllers: [TicketsController],
  providers: [TicketsService, TicketNumberService, TicketEventsService, TicketStatusService],
  exports: [
    TicketNumberService,
    TicketEventsService,
    TicketStatusService,
    TicketsService,
    NotificationsModule,
  ],
})
export class TicketsModule {}
