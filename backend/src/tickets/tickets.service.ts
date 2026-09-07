import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  Prisma,
  Ticket,
  TicketEventType,
  TicketOrigin,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SlaService } from '../sla/sla.service.js';
import { publicUser } from '../users/user-view.js';
import { TicketNumberService } from './ticket-number.service.js';
import { TicketEventsService } from './ticket-events.service.js';
import { TicketStatusService } from './ticket-status.service.js';
import type { TicketNotifier } from './ticket-notifier.js';
import type { ListTicketsDto } from './dto/list-tickets.dto.js';

// Eventos ocultados de quem é do lado do cliente.
const INTERNAL_EVENT_TYPES = new Set<TicketEventType>([
  'ASSIGNED',
  'PRIORITY_CHANGED',
  'EMAIL_OUT',
]);

const NON_TERMINAL_ONLY: Prisma.TicketWhereInput['status'] = {
  notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'],
};

type Actor = { id: string; type?: string; role?: string; clientId?: string | null };

export type CreateTicketInput = {
  title: string;
  description: string;
  clientId?: string | null;
  requesterId?: string | null;
  categoryId?: string | null;
  priority?: TicketPriority;
  origin: TicketOrigin;
  equipment?: string | null;
};

@Injectable()
export class TicketsService {
  private readonly logger = new Logger('TicketsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketNumber: TicketNumberService,
    private readonly sla: SlaService,
    private readonly events: TicketEventsService,
    private readonly statusRules: TicketStatusService,
    @Inject('TicketNotifier') private readonly notifier: TicketNotifier,
  ) {}

  async create(input: CreateTicketInput, actor?: Actor): Promise<Ticket> {
    const priority: TicketPriority = input.priority ?? 'MEDIUM';
    const hasParties = Boolean(input.clientId && input.requesterId);

    if ((input.origin === 'PORTAL' || input.origin === 'MANUAL') && !hasParties) {
      throw new BadRequestException(
        'clientId e requesterId são obrigatórios para chamados de portal ou manuais.',
      );
    }
    const needsTriage = input.origin === 'EMAIL' && !hasParties;

    // read-only, pode ficar fora da transação
    const slaDueAt = await this.sla.dueAt(priority, new Date());

    const ticket = await this.prisma.$transaction(async (tx) => {
      const number = await this.ticketNumber.next(tx);
      const created = await tx.ticket.create({
        data: {
          number,
          title: input.title,
          description: input.description,
          clientId: input.clientId ?? null,
          requesterId: input.requesterId ?? null,
          categoryId: input.categoryId ?? null,
          priority,
          status: 'OPEN',
          origin: input.origin,
          equipment: input.equipment ?? null,
          needsTriage,
          slaDueAt,
        },
      });
      await this.events.record(tx, created.id, 'CREATED', {}, actor?.id);
      return created;
    });

    try {
      await this.notifier.created(ticket);
    } catch (err) {
      this.logger.warn(
        `notificação de criação falhou para ${ticket.number}: ${(err as Error).message}`,
      );
    }
    return ticket;
  }

  /** Listagem paginada com escopo por papel + filtros. */
  async findAll(query: ListTicketsDto, actor: Actor) {
    const where: Prisma.TicketWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.clientId) where.clientId = query.clientId;
    if (query.assigneeId) where.assigneeId = query.assigneeId;
    if (query.categoryId) where.categoryId = query.categoryId;

    if (query.overdue) {
      where.slaDueAt = { lt: new Date() };
      where.status = NON_TERMINAL_ONLY;
    }

    if (query.q) {
      where.OR = [
        { number: { contains: query.q, mode: 'insensitive' } },
        { title: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    // Escopo por papel — aplicado por último, vence filtros conflitantes do query.
    if (actor.role === 'CONTACT') {
      where.requesterId = actor.id;
    } else if (actor.role === 'MANAGER') {
      where.clientId = actor.clientId ?? '__no_client__';
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const [data, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  /** `true` se o `actor` pode enxergar o chamado. INTERNAL sempre pode. */
  private inScope(
    ticket: { requesterId: string | null; clientId: string | null },
    actor: Actor,
  ): boolean {
    if (actor.role === 'CONTACT') return ticket.requesterId === actor.id;
    if (actor.role === 'MANAGER') return ticket.clientId === (actor.clientId ?? null);
    return true;
  }

  /** Detalhe com timeline. Fora do escopo → `NotFoundException` (não vaza existência). */
  async findOne(id: string, actor: Actor) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        client: true,
        requester: true,
        assignee: true,
        category: true,
        comments: { orderBy: { createdAt: 'asc' } },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket || !this.inScope(ticket, actor)) {
      throw new NotFoundException('Chamado não encontrado.');
    }

    const isClientSide = actor.type === 'CLIENT';
    return {
      ...ticket,
      requester: ticket.requester ? publicUser(ticket.requester) : null,
      assignee: ticket.assignee ? publicUser(ticket.assignee) : null,
      comments: isClientSide
        ? ticket.comments.filter((c) => c.visibility !== 'INTERNAL')
        : ticket.comments,
      events: isClientSide
        ? ticket.events.filter((e) => !INTERNAL_EVENT_TYPES.has(e.type))
        : ticket.events,
    };
  }

  /** Muda o status aplicando a tabela de transições e os efeitos colaterais. */
  async changeStatus(id: string, next: TicketStatus, actor?: Actor): Promise<Ticket> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('Chamado não encontrado.');

    this.statusRules.assertTransition(ticket.status, next);

    const data: Prisma.TicketUpdateInput = { status: next };
    if (next === 'RESOLVED') data.resolvedAt = new Date();
    if (next === 'CLOSED') data.closedAt = new Date();
    if (next === 'OPEN' && (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED')) {
      data.resolvedAt = null;
      data.closedAt = null;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.ticket.update({ where: { id }, data });
      await this.events.record(
        tx,
        id,
        'STATUS_CHANGED',
        { from: ticket.status, to: next },
        actor?.id,
      );
      return u;
    });

    if (next === 'RESOLVED') await this.notify((n) => n.resolved(updated), updated);
    return updated;
  }

  /** Define/remove o responsável. `null` desatribui. */
  async assign(id: string, assigneeId: string | null, actor?: Actor): Promise<Ticket> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('Chamado não encontrado.');
    const from = ticket.assigneeId;

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.ticket.update({ where: { id }, data: { assigneeId } });
      await this.events.record(tx, id, 'ASSIGNED', { from, to: assigneeId }, actor?.id);
      return u;
    });

    if (assigneeId && assigneeId !== from) {
      await this.notify((n) => n.assigned(updated), updated);
    }
    return updated;
  }

  /** Muda a prioridade; recalcula o SLA se o chamado não está em status terminal. */
  async changePriority(
    id: string,
    priority: TicketPriority,
    actor?: Actor,
  ): Promise<Ticket> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('Chamado não encontrado.');
    const from = ticket.priority;

    const data: Prisma.TicketUpdateInput = { priority };
    const terminal =
      ticket.status === 'RESOLVED' ||
      ticket.status === 'CLOSED' ||
      ticket.status === 'CANCELLED';
    if (!terminal) {
      data.slaDueAt = await this.sla.dueAt(priority, ticket.createdAt);
    }

    return this.prisma.$transaction(async (tx) => {
      const u = await tx.ticket.update({ where: { id }, data });
      await this.events.record(tx, id, 'PRIORITY_CHANGED', { from, to: priority }, actor?.id);
      return u;
    });
  }

  /** Dispara notificação sem deixar a falha abortar a operação. */
  private async notify(fn: (n: TicketNotifier) => Promise<void>, ticket: Ticket): Promise<void> {
    try {
      await fn(this.notifier);
    } catch (err) {
      this.logger.warn(
        `notificação falhou para ${ticket.number}: ${(err as Error).message}`,
      );
    }
  }
}
