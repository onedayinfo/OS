import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import type { TicketNotifier } from '../tickets/ticket-notifier.js';

const SLA_TERMINAL_STATUSES = ['RESOLVED', 'CLOSED', 'CANCELLED'] as const;

/**
 * Varredura periódica de SLA vencido. Notifica uma única vez por chamado
 * (idempotência via `slaBreachNotifiedAt`).
 *
 * ponytail: sem lock distribuído — MVP roda instância única. Múltiplas
 * instâncias renotificariam o mesmo ticket na janela entre `findMany` e
 * `update`; nesse cenário, trocar por `SELECT ... FOR UPDATE SKIP LOCKED`
 * ou um advisory lock por ciclo.
 */
@Injectable()
export class SlaBreachCron {
  private readonly logger = new Logger(SlaBreachCron.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('TicketNotifier') private readonly notifier: TicketNotifier,
  ) {}

  @Cron('*/15 * * * *')
  async run(): Promise<void> {
    const overdue = await this.prisma.ticket.findMany({
      where: {
        slaDueAt: { lt: new Date() },
        status: { notIn: [...SLA_TERMINAL_STATUSES] },
        slaBreachNotifiedAt: null,
      },
    });

    for (const ticket of overdue) {
      try {
        await this.notifier.slaBreached(ticket);
        await this.prisma.ticket.update({
          where: { id: ticket.id },
          data: { slaBreachNotifiedAt: new Date() },
        });
      } catch (err) {
        // Não marca como notificado: tenta de novo no próximo ciclo.
        this.logger.error(
          `Falha ao notificar SLA vencido do ticket ${ticket.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    if (overdue.length > 0) {
      this.logger.log(`SLA vencido: ${overdue.length} chamado(s) processado(s)`);
    }
  }
}
