import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma, Ticket, TicketOrigin, TicketPriority } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SlaService } from '../sla/sla.service.js';
import { TicketNumberService } from './ticket-number.service.js';
import { TicketEventsService } from './ticket-events.service.js';
import type { TicketNotifier } from './ticket-notifier.js';
import type { ListTicketsDto } from './dto/list-tickets.dto.js';

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
}
