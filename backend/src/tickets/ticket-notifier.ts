import { Injectable, Logger } from '@nestjs/common';
import type { Ticket } from '@prisma/client';

/**
 * Porta de notificação de chamados. Consumida por `TicketsService`.
 * Registrada com `provide: 'TicketNotifier'`.
 */
export interface TicketNotifier {
  created(ticket: Ticket): Promise<void>;
  resolved(ticket: Ticket): Promise<void>;
  assigned(ticket: Ticket): Promise<void>;
}

// ponytail: impl temporária da Fase 5 — só loga. A Fase 8 troca pelo
// NotificationsService mantendo o token 'TicketNotifier'.
@Injectable()
export class LoggerTicketNotifier implements TicketNotifier {
  private readonly logger = new Logger('TicketNotifier');

  async created(ticket: Ticket): Promise<void> {
    this.logger.log(`chamado criado ${ticket.number}`);
  }
  async resolved(ticket: Ticket): Promise<void> {
    this.logger.log(`chamado resolvido ${ticket.number}`);
  }
  async assigned(ticket: Ticket): Promise<void> {
    this.logger.log(`chamado atribuído ${ticket.number} -> ${ticket.assigneeId ?? 'ninguém'}`);
  }
}
