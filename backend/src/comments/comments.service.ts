import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { TicketComment } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import type { Actor } from '../tickets/tickets.service.js';
import { TicketEventsService } from '../tickets/ticket-events.service.js';
import { resolveClientReply } from '../tickets/ticket-status.service.js';
import type { TicketNotifier } from '../tickets/ticket-notifier.js';
import type { CreateCommentDto } from './dto/create-comment.dto.js';

@Injectable()
export class CommentsService {
  private readonly logger = new Logger('CommentsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
    private readonly events: TicketEventsService,
    @Inject('TicketNotifier') private readonly notifier: TicketNotifier,
  ) {}

  /**
   * Cria um andamento no chamado.
   * - Guarda de acesso: reusa o escopo do `TicketsService` (`assertAccess` →
   *   `NotFoundException` se o `actor` não enxerga o chamado).
   * - `CLIENT` só pode `PUBLIC`; `INTERNAL` vindo de cliente é rejeitado.
   * - Grava `TicketComment` + `TicketEvent COMMENT` na mesma transação.
   * - Autor interno + 1º `PUBLIC` → grava `firstResponseAt` (mesma tx).
   * - Autor cliente → `resolveClientReply` (WAITING_CLIENT volta a IN_PROGRESS).
   * - `PUBLIC` → notifica fora da tx (falha não aborta).
   */
  async create(
    ticketId: string,
    dto: CreateCommentDto,
    actor: Actor,
  ): Promise<TicketComment> {
    const ticket = await this.tickets.assertAccess(ticketId, actor);

    const isClient = actor.type === 'CLIENT';
    if (isClient && dto.visibility === 'INTERNAL') {
      throw new ForbiddenException('Cliente não pode criar comentário interno.');
    }

    const setsFirstResponse =
      actor.type === 'INTERNAL' &&
      dto.visibility === 'PUBLIC' &&
      ticket.firstResponseAt == null;

    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.ticketComment.create({
        data: {
          ticketId,
          authorId: actor.id,
          body: dto.body,
          visibility: dto.visibility,
        },
      });
      await this.events.record(
        tx,
        ticketId,
        'COMMENT',
        { visibility: dto.visibility },
        actor.id,
      );
      if (setsFirstResponse) {
        await tx.ticket.update({
          where: { id: ticketId },
          data: { firstResponseAt: new Date() },
        });
      }
      if (isClient) {
        await resolveClientReply(tx, ticketId);
      }
      return created;
    });

    if (dto.visibility === 'PUBLIC') {
      try {
        await this.notifier.publicComment(ticket, comment);
      } catch (err) {
        this.logger.warn(
          `notificação de comentário falhou para ${ticket.number}: ${(err as Error).message}`,
        );
      }
    }
    return comment;
  }
}
