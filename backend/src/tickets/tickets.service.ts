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
import { ContractsService } from '../contracts/contracts.service.js';
import { SurveysService } from '../surveys/surveys.service.js';
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

const TERMINAL_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED', 'CANCELLED'];
const NON_TERMINAL_ONLY: Prisma.TicketWhereInput['status'] = {
  notIn: TERMINAL_STATUSES,
};

export type Actor = { id: string; type?: string; role?: string; clientId?: string | null };

/**
 * Allowlist do anexo exposto em respostas de API. Nunca inclui `storedPath`
 * (caminho absoluto no FS) nem `uploadedById` — o download lê o `storedPath`
 * direto do banco, não da resposta.
 */
export function publicAttachment(a: {
  id: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: Date;
  ticketId: string | null;
  commentId: string | null;
  assetId?: string | null;
  visitId?: string | null;
  kind?: string;
}) {
  return {
    id: a.id,
    filename: a.filename,
    mime: a.mime,
    size: a.size,
    createdAt: a.createdAt,
    ticketId: a.ticketId,
    commentId: a.commentId,
    assetId: a.assetId ?? null,
    visitId: a.visitId ?? null,
    kind: a.kind ?? 'GENERIC',
  };
}

/** Escopo de visibilidade derivado de `type` + `role`. */
type Scope =
  | { kind: 'all' } // sem restrição (interno ADMIN/AGENT)
  | { kind: 'none' } // nenhum chamado visível (dado inconsistente ou sem cliente)
  | { kind: 'requester'; id: string } // só os próprios chamados
  | { kind: 'client'; id: string }; // todos os chamados de um cliente

// Sentinela impossível: força resultado vazio no `where` sem depender de outros filtros.
const NO_ACCESS_SENTINEL = '__no_access__';

/**
 * Traduz `actor` em escopo de visibilidade. Fail-closed: se `type` e `role`
 * divergem, cai na opção mais restritiva ou nega o acesso — nunca "sem restrição".
 */
function roleScope(actor: Actor): Scope {
  if (actor.type === 'CLIENT') {
    // Lado do cliente: MANAGER enxerga o cliente inteiro; qualquer outro papel
    // (inclusive inconsistente) é tratado como CONTACT — só os próprios.
    if (actor.role === 'MANAGER') {
      return actor.clientId ? { kind: 'client', id: actor.clientId } : { kind: 'none' };
    }
    return { kind: 'requester', id: actor.id };
  }
  if (actor.type === 'INTERNAL') {
    // Interno só vê tudo se for ADMIN/AGENT; caso contrário, sem acesso.
    return actor.role === 'ADMIN' || actor.role === 'AGENT'
      ? { kind: 'all' }
      : { kind: 'none' };
  }
  // `type` ausente/desconhecido: decide pelo papel, ainda fail-closed.
  if (actor.role === 'CONTACT') return { kind: 'requester', id: actor.id };
  if (actor.role === 'MANAGER') {
    return actor.clientId ? { kind: 'client', id: actor.clientId } : { kind: 'none' };
  }
  if (actor.role === 'ADMIN' || actor.role === 'AGENT') return { kind: 'all' };
  return { kind: 'none' };
}

export type CreateTicketInput = {
  title: string;
  description: string;
  clientId?: string | null;
  requesterId?: string | null;
  categoryId?: string | null;
  priority?: TicketPriority;
  /** Ausente → derivado do `actor`: CLIENT ⇒ PORTAL, caso contrário MANUAL. */
  origin?: TicketOrigin;
  locationId?: string | null;
  assetIds?: string[];
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
    private readonly contracts: ContractsService,
    private readonly surveys: SurveysService,
  ) {}

  async create(input: CreateTicketInput, actor?: Actor): Promise<Ticket> {
    const priority: TicketPriority = input.priority ?? 'MEDIUM';

    // Abertura pelo portal: cliente/solicitante/origin vêm do token, não do body
    // (tentativa de forjar cliente alheio é ignorada — o do token vence).
    const fromPortal = actor?.type === 'CLIENT';
    // Ator interno via `POST /api/tickets` sempre abre chamado MANUAL — `origin`
    // do body é ignorado. O inbound de e-mail chama o service direto (sem
    // `actor`) e continua ditando `origin: 'EMAIL'`.
    const origin: TicketOrigin = fromPortal
      ? 'PORTAL'
      : actor
        ? 'MANUAL'
        : input.origin ?? 'MANUAL';
    const clientId = fromPortal ? actor!.clientId ?? null : input.clientId ?? null;
    const requesterId = fromPortal ? actor!.id : input.requesterId ?? null;

    const hasParties = Boolean(clientId && requesterId);

    if ((origin === 'PORTAL' || origin === 'MANUAL') && !hasParties) {
      throw new BadRequestException(
        'clientId e requesterId são obrigatórios para chamados de portal ou manuais.',
      );
    }

    // Criação interna (ator INTERNAL, não portal): o solicitante tem de ser um
    // contato CLIENT ativo do cliente informado — mesma checagem do `triage`.
    if (!fromPortal && actor && hasParties) {
      const requester = await this.prisma.user.findUnique({ where: { id: requesterId! } });
      if (
        !requester ||
        requester.active === false ||
        requester.type !== 'CLIENT' ||
        requester.clientId !== clientId
      ) {
        throw new BadRequestException(
          'Solicitante inválido, inativo ou de outro cliente.',
        );
      }
    }

    const needsTriage = origin === 'EMAIL' && !hasParties;

    const locationId = input.locationId ?? null;
    // dedup: ids repetidos furam o check `assets.length !== assetIds.length`.
    const assetIds = [...new Set(input.assetIds ?? [])];
    await this.validateLocationAndAssets(clientId, locationId, assetIds);
    const contractId = await this.contracts.resolveForTicket(clientId, locationId, assetIds);

    // read-only, pode ficar fora da transação
    const slaDueAt = await this.sla.dueAt(
      priority,
      new Date(),
      contractId ?? undefined,
      input.categoryId ?? undefined,
    );

    const ticket = await this.prisma.$transaction(async (tx) => {
      const number = await this.ticketNumber.next(tx);
      const created = await tx.ticket.create({
        data: {
          number,
          title: input.title,
          description: input.description,
          clientId,
          requesterId,
          categoryId: input.categoryId ?? null,
          priority,
          status: 'OPEN',
          origin,
          locationId,
          contractId,
          ...(assetIds.length
            ? { assets: { connect: assetIds.map((id) => ({ id })) } }
            : {}),
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

  /**
   * Cria o chamado gerado pela aprovação de um orçamento avulso — mesmo
   * padrão sem `actor` já usado pelo `ContractPreventiveCron`: sem
   * solicitante humano, `needsTriage: false` (o orçamento já qualificou o
   * pedido), `origin: 'QUOTE'`.
   */
  async createFromQuote(
    tx: Prisma.TransactionClient,
    input: { clientId: string; categoryId: string; title: string; quoteId: string },
  ): Promise<Ticket> {
    const slaDueAt = await this.sla.dueAt('MEDIUM', new Date(), undefined, input.categoryId);
    const number = await this.ticketNumber.next(tx);
    const created = await tx.ticket.create({
      data: {
        number,
        title: input.title,
        description: 'Chamado gerado automaticamente a partir de um orçamento aprovado.',
        clientId: input.clientId,
        requesterId: null,
        categoryId: input.categoryId,
        priority: 'MEDIUM',
        status: 'OPEN',
        origin: 'QUOTE',
        originQuoteId: input.quoteId,
        needsTriage: false,
        slaDueAt,
      },
    });
    await this.events.record(tx, created.id, 'CREATED', {}, undefined);
    return created;
  }

  /** Regra: local pertence ao cliente do chamado; todo ativo pertence a esse local. */
  private async validateLocationAndAssets(
    clientId: string | null,
    locationId: string | null,
    assetIds: string[],
  ): Promise<void> {
    if (!locationId) {
      if (assetIds.length) {
        throw new BadRequestException('Informe um local antes de vincular ativos.');
      }
      return;
    }
    const location = await this.prisma.location.findUnique({ where: { id: locationId } });
    if (!location) throw new BadRequestException('Local não encontrado.');
    if (clientId && location.clientId !== clientId) {
      throw new BadRequestException('O local não pertence ao cliente do chamado.');
    }
    if (assetIds.length) {
      const assets = await this.prisma.asset.findMany({
        where: { id: { in: assetIds } },
        select: { id: true, locationId: true },
      });
      if (assets.length !== assetIds.length) {
        throw new BadRequestException('Um ou mais ativos não existem.');
      }
      const foreign = assets.filter((a) => a.locationId !== locationId);
      if (foreign.length) {
        throw new BadRequestException('Um ou mais ativos não pertencem ao local informado.');
      }
    }
  }

  /**
   * Redefine local + ativos vinculados. `locationId` null limpa o local e força
   * `assetIds` vazio. Grava `LOCATION_CHANGED`/`ASSETS_CHANGED` só quando muda.
   */
  async setTicketAssets(
    id: string,
    input: { locationId: string | null; assetIds: string[] },
    actor: Actor,
  ): Promise<Ticket> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: { assets: { select: { id: true } } },
    });
    if (!ticket) throw new NotFoundException('Chamado não encontrado.');

    const locationId = input.locationId ?? null;
    // dedup: ids repetidos furam o check em validateLocationAndAssets.
    const assetIds = locationId ? [...new Set(input.assetIds)] : [];
    await this.validateLocationAndAssets(ticket.clientId, locationId, assetIds);
    const contractId = await this.contracts.resolveForTicket(ticket.clientId, locationId, assetIds);

    const before = ticket.assets.map((a) => a.id).sort();
    const after = [...assetIds].sort();
    const assetsChanged = before.join(',') !== after.join(',');
    const locationChanged = (ticket.locationId ?? null) !== locationId;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.update({
        where: { id },
        data: { locationId, contractId, assets: { set: assetIds.map((aid) => ({ id: aid })) } },
      });
      if (locationChanged) {
        await this.events.record(
          tx,
          id,
          'LOCATION_CHANGED',
          { from: ticket.locationId ?? null, to: locationId },
          actor.id,
        );
      }
      if (assetsChanged) {
        await this.events.record(tx, id, 'ASSETS_CHANGED', { from: before, to: after }, actor.id);
      }
      return updated;
    });
  }

  /** Listagem paginada com escopo por papel + filtros. */
  async findAll(query: ListTicketsDto, actor: Actor) {
    const where: Prisma.TicketWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.clientId) where.clientId = query.clientId;
    if (query.assigneeId) where.assigneeId = query.assigneeId;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.needsTriage !== undefined) where.needsTriage = query.needsTriage;

    if (query.overdue) {
      where.slaDueAt = { lt: new Date() };
      // Combina com um `?status=` explícito em vez de sobrescrevê-lo.
      where.status = query.status
        ? { equals: query.status, notIn: TERMINAL_STATUSES }
        : NON_TERMINAL_ONLY;
    }

    if (query.q) {
      where.OR = [
        { number: { contains: query.q, mode: 'insensitive' } },
        { title: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    // Escopo por papel — aplicado por último, vence filtros conflitantes do query.
    const scope = roleScope(actor);
    if (scope.kind === 'requester') where.requesterId = scope.id;
    else if (scope.kind === 'client') where.clientId = scope.id;
    else if (scope.kind === 'none') where.id = NO_ACCESS_SENTINEL;

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

  /**
   * `true` se o `actor` pode enxergar o chamado. Usa o mesmo `roleScope` do
   * `findAll` para não divergirem. Nunca compara `null === null`: os escopos
   * `requester`/`client` só casam com um id concreto.
   */
  private inScope(
    ticket: { requesterId: string | null; clientId: string | null },
    actor: Actor,
  ): boolean {
    const scope = roleScope(actor);
    if (scope.kind === 'all') return true;
    if (scope.kind === 'none') return false;
    if (scope.kind === 'requester') return ticket.requesterId === scope.id;
    return ticket.clientId === scope.id;
  }

  /**
   * Garante que `actor` enxerga o chamado e devolve o registro cru. Reusa o
   * mesmo escopo do `findOne`; fora do escopo → `NotFoundException`. Consumido
   * por `CommentsService` e `AttachmentsService` como guarda de acesso.
   */
  async assertAccess(ticketId: string, actor: Actor): Promise<Ticket> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket || !this.inScope(ticket, actor)) {
      throw new NotFoundException('Chamado não encontrado.');
    }
    return ticket;
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
        location: true,
        contract: { select: { id: true, name: true } },
        // `select` (não `include`): `include` traria todo scalar de Asset,
        // inclusive `credentialsEnc`, e o retorno espalha `...ticket`.
        // Spec §3.2: o detalhe do chamado só expõe id/label/tipo do ativo — nada
        // de status/brand/model/serial/ip/mac (o lado cliente vê o próprio chamado).
        assets: {
          select: {
            id: true,
            label: true,
            type: { select: { id: true, name: true } },
          },
        },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { attachments: true },
        },
        events: { orderBy: { createdAt: 'asc' } },
        attachments: { orderBy: { createdAt: 'asc' } },
        satisfactionSurvey: { select: { score: true, comment: true, respondedAt: true } },
      },
    });
    if (!ticket || !this.inScope(ticket, actor)) {
      throw new NotFoundException('Chamado não encontrado.');
    }

    const isClientSide = actor.type === 'CLIENT';
    const visibleComments = isClientSide
      ? ticket.comments.filter((c) => c.visibility !== 'INTERNAL')
      : ticket.comments;
    return {
      ...ticket,
      requester: ticket.requester ? publicUser(ticket.requester) : null,
      // Lado do cliente não vê dados operacionais internos: o agente responsável
      // (eventos ASSIGNED já são escondidos), o SLA (spec §9 permite omitir) e a
      // flag de triagem (chamado de triagem tem clientId=null; normalizado mesmo assim).
      assignee: isClientSide || !ticket.assignee ? null : publicUser(ticket.assignee),
      slaDueAt: isClientSide ? null : ticket.slaDueAt,
      needsTriage: isClientSide ? false : ticket.needsTriage,
      attachments: (ticket.attachments ?? []).map(publicAttachment),
      comments: visibleComments.map((c) => ({
        ...c,
        attachments: (c.attachments ?? []).map(publicAttachment),
      })),
      // ponytail: cliente não vê nenhum evento COMMENT — o comentário público já
      // vai no array `comments`; assim a nota interna não vaza (existência/hora/
      // actorId) pela timeline via evento COMMENT com data.visibility=INTERNAL.
      events: isClientSide
        ? ticket.events.filter(
            (e) => !INTERNAL_EVENT_TYPES.has(e.type) && e.type !== 'COMMENT',
          )
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

    const { updated, survey } = await this.prisma.$transaction(async (tx) => {
      const u = await tx.ticket.update({ where: { id }, data });
      await this.events.record(
        tx,
        id,
        'STATUS_CHANGED',
        { from: ticket.status, to: next },
        actor?.id,
      );
      const survey = next === 'CLOSED' ? await this.surveys.createForTicket(tx, u) : null;
      return { updated: u, survey };
    });

    if (next === 'RESOLVED') await this.notify((n) => n.resolved(updated), updated);
    if (survey) await this.notify((n) => n.surveyRequested(updated, survey), updated);
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

  /**
   * Vincula um chamado de e-mail da fila de triagem a um cliente + solicitante.
   * Só age se `needsTriage`; valida que o solicitante pertence ao cliente.
   * Grava um comentário INTERNAL automático de vínculo (autor = quem triou).
   */
  async triage(
    id: string,
    input: { clientId: string; requesterId: string },
    actor: Actor,
  ): Promise<Ticket> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('Chamado não encontrado.');
    if (!ticket.needsTriage) {
      throw new BadRequestException('Chamado não está na fila de triagem.');
    }

    const client = await this.prisma.client.findUnique({ where: { id: input.clientId } });
    if (!client || client.active === false) {
      throw new BadRequestException('Cliente inválido ou inativo.');
    }

    const requester = await this.prisma.user.findUnique({ where: { id: input.requesterId } });
    if (
      !requester ||
      requester.active === false ||
      requester.type !== 'CLIENT' ||
      requester.clientId !== input.clientId
    ) {
      throw new BadRequestException('Solicitante inválido, inativo ou de outro cliente.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.update({
        where: { id },
        data: {
          clientId: input.clientId,
          requesterId: input.requesterId,
          needsTriage: false,
        },
      });
      await tx.ticketComment.create({
        data: {
          ticketId: id,
          authorId: actor.id,
          body: `Chamado vinculado ao cliente ${client.name}.`,
          visibility: 'INTERNAL',
        },
      });
      await this.events.record(tx, id, 'COMMENT', { visibility: 'INTERNAL' }, actor.id);
      return updated;
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
