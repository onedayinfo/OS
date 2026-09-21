import type { Ticket, TicketComment, TicketSatisfactionSurvey } from '@prisma/client';

/**
 * Porta de notificação de chamados. Consumida por `TicketsService` e
 * `CommentsService`. Registrada com `provide: 'TicketNotifier'`.
 * Impl real: `NotificationsService` (Fase 8). `slaBreached` é usado pela Fase 10.
 */
export interface TicketNotifier {
  created(ticket: Ticket): Promise<void>;
  resolved(ticket: Ticket): Promise<void>;
  assigned(ticket: Ticket): Promise<void>;
  publicComment(ticket: Ticket, comment: TicketComment): Promise<void>;
  slaBreached(ticket: Ticket): Promise<void>;
  surveyRequested(ticket: Ticket, survey: TicketSatisfactionSurvey): Promise<void>;
}
