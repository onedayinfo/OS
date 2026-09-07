import { Module } from '@nestjs/common';
import { TicketNumberService } from './ticket-number.service.js';

// Módulo mínimo: a Fase 5 completa com controller/service de chamados.
@Module({
  providers: [TicketNumberService],
  exports: [TicketNumberService],
})
export class TicketsModule {}
