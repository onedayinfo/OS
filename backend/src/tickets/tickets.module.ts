import { Module } from '@nestjs/common';
import { SlaModule } from '../sla/sla.module.js';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';
import { TicketNumberService } from './ticket-number.service.js';
import { TicketEventsService } from './ticket-events.service.js';
import { TicketStatusService } from './ticket-status.service.js';
import { LoggerTicketNotifier } from './ticket-notifier.js';

@Module({
  imports: [SlaModule],
  controllers: [TicketsController],
  providers: [
    TicketsService,
    TicketNumberService,
    TicketEventsService,
    TicketStatusService,
    { provide: 'TicketNotifier', useClass: LoggerTicketNotifier },
  ],
  exports: [TicketNumberService, TicketEventsService, TicketStatusService, TicketsService],
})
export class TicketsModule {}
