import { Injectable, Logger } from '@nestjs/common';
import type { Ticket, TicketComment, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { TicketNotifier } from '../tickets/ticket-notifier.js';
import { EmailService } from '../email/email.service.js';
import {
  ticketAssigned,
  ticketComment,
  ticketCreated,
  ticketCreatedInternal,
  ticketResolved,
  ticketSlaBreached,
  type RenderedEmail,
} from '../email/templates.js';

/**
 * Impl real do token `'TicketNotifier'`. Resolve destinatários no Prisma e
 * chama `EmailService.send` uma vez por destinatário. Só depende de Prisma +
 * Email — nunca importa `TicketsModule`/`CommentsModule` (evita ciclo de módulo).
 */
@Injectable()
export class NotificationsService implements TicketNotifier {
  private readonly logger = new Logger('NotificationsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async created(ticket: Ticket): Promise<void> {
    const brand = await this.email.brand();
    const requester = await this.userById(ticket.requesterId);
    if (requester) await this.deliver(requester.email, ticketCreated(ticket, brand), ticket);
    for (const admin of await this.admins()) {
      await this.deliver(admin.email, ticketCreatedInternal(ticket, brand), ticket);
    }
  }

  async publicComment(ticket: Ticket, comment: TicketComment): Promise<void> {
    const byId = new Map<string, User>();
    const requester = await this.userById(ticket.requesterId);
    if (requester) byId.set(requester.id, requester);
    if (ticket.clientId) {
      const managers = await this.prisma.user.findMany({
        where: { clientId: ticket.clientId, role: 'MANAGER', active: true },
      });
      for (const m of managers) byId.set(m.id, m);
    }
    byId.delete(comment.authorId);
    const brand = await this.email.brand();
    for (const u of byId.values()) {
      await this.deliver(u.email, ticketComment(ticket, comment, brand), ticket);
    }
  }

  async assigned(ticket: Ticket): Promise<void> {
    const assignee = await this.userById(ticket.assigneeId);
    if (assignee) {
      await this.deliver(assignee.email, ticketAssigned(ticket, await this.email.brand()), ticket);
    }
  }

  async resolved(ticket: Ticket): Promise<void> {
    const requester = await this.userById(ticket.requesterId);
    if (requester) {
      await this.deliver(requester.email, ticketResolved(ticket, await this.email.brand()), ticket);
    }
  }

  async slaBreached(ticket: Ticket): Promise<void> {
    const byId = new Map<string, User>();
    const assignee = await this.userById(ticket.assigneeId);
    if (assignee) byId.set(assignee.id, assignee);
    for (const admin of await this.admins()) byId.set(admin.id, admin);
    const brand = await this.email.brand();
    for (const u of byId.values()) {
      await this.deliver(u.email, ticketSlaBreached(ticket, brand), ticket);
    }
  }

  private userById(id: string | null): Promise<User | null> {
    if (!id) return Promise.resolve(null);
    return this.prisma.user.findUnique({ where: { id } });
  }

  private admins(): Promise<User[]> {
    return this.prisma.user.findMany({
      where: { type: 'INTERNAL', role: 'ADMIN', active: true },
    });
  }

  private async deliver(to: string, tpl: RenderedEmail, ticket: Ticket): Promise<void> {
    try {
      await this.email.send({ to, ...tpl, headers: { References: ticket.number } });
    } catch (err) {
      this.logger.warn(`notificação falhou para ${to} (${ticket.number}): ${(err as Error).message}`);
    }
  }
}
