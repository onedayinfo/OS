import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Integration, TicketPriority } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { TicketEventsService } from '../tickets/ticket-events.service.js';
import { hashToken, newToken } from '../agent/token.util.js';
import { IntegrationEventDto } from './dto/integration-event.dto.js';
import type {
  CreateIntegrationDto,
  IntegrationMappingDto,
  UpdateIntegrationDto,
} from './dto/integration.dto.js';
import { renderTemplate, truncateStrings } from './template.util.js';

export const SEVERITY_PRIORITY: Record<string, TicketPriority> = {
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
  urgent: 'URGENT',
};

const TERMINAL = ['RESOLVED', 'CLOSED', 'CANCELLED'] as const;

const INCLUDE = {
  client: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
} as const;
/** Lista: sem segredo e sem o exemplo (pode ser grande). */
const LIST_VIEW = {
  omit: { tokenHash: true, lastPayload: true, recentPayloads: true },
  include: INCLUDE,
} as const;
/** Quantos eventos recentes guardar como exemplo. */
const RECENT_MAX = 10;
/** Detalhe/escrita: sem segredo, com o exemplo. */
const VIEW = { omit: { tokenHash: true }, include: INCLUDE } as const;

/** Campos do chamado já resolvidos a partir de um evento. */
export type EventFields = {
  title: string;
  description?: string | null;
  priority: TicketPriority;
  externalId?: string | null;
  assetSerial?: string | null;
};

export type IngestResult =
  | { captured: true }
  | { ignored: true; reason: string }
  | { ticketId: string; number: string; created: boolean }
  | { ticketId: string; number: string; resolved: true };

/** Classifica o evento pela regra de status: abre, normaliza ou ignora; `null` = sem regra. */
export function classifyStatus(
  mapping: IntegrationMappingDto,
  payload: unknown,
): { kind: 'problem' | 'ok' | 'ignore'; value: string } | null {
  if (!mapping.status?.trim()) return null;
  const value = renderTemplate(mapping.status, payload);
  const norm = (v: string) => v.trim().toLowerCase();
  const v = norm(value);
  const ok = (mapping.okValues ?? []).map(norm).filter(Boolean);
  const problem = (mapping.problemValues ?? []).map(norm).filter(Boolean);
  if (v && ok.includes(v)) return { kind: 'ok', value };
  // Sem lista de "problema": qualquer valor (não vazio) que não normaliza abre chamado.
  if (v && (problem.length ? problem.includes(v) : true)) return { kind: 'problem', value };
  return { kind: 'ignore', value };
}

/** Extrai o token de `Authorization: Bearer <t>` ou `x-webhook-token`. */
export function extractToken(auth?: string, header?: string): string | undefined {
  const m = auth?.match(/^Bearer\s+(.+)$/i);
  return (m?.[1] ?? header)?.trim() || undefined;
}

/** Aplica o mapeamento (modelos `{{caminho}}`) ao JSON recebido. */
export function applyMapping(mapping: IntegrationMappingDto, payload: unknown): EventFields {
  return {
    title: renderTemplate(mapping.title, payload).slice(0, 200),
    description: renderTemplate(mapping.description, payload).slice(0, 10000) || null,
    priority: mapping.priority ?? 'MEDIUM',
    externalId: renderTemplate(mapping.externalId, payload).slice(0, 200) || null,
    assetSerial: renderTemplate(mapping.assetSerial, payload).slice(0, 200) || null,
  };
}

const hasTitle = (p: unknown): boolean =>
  !!p && typeof p === 'object' && !Array.isArray(p) && 'title' in p;

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
    private readonly events: TicketEventsService,
  ) {}

  findAll() {
    return this.prisma.integration.findMany({ ...LIST_VIEW, orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const row = await this.prisma.integration.findUnique({ ...VIEW, where: { id } });
    if (!row) throw new NotFoundException('Integração não encontrada.');
    return row;
  }

  async create(dto: CreateIntegrationDto) {
    const { token, hash } = newToken();
    const row = await this.prisma.integration.create({
      ...VIEW,
      data: {
        name: dto.name,
        clientId: dto.clientId,
        categoryId: dto.categoryId ?? null,
        tokenHash: hash,
      },
    });
    return { ...row, token };
  }

  async update(id: string, dto: UpdateIntegrationDto) {
    await this.assertExists(id);
    const { mapping, ...rest } = dto;
    return this.prisma.integration.update({
      ...VIEW,
      where: { id },
      data: {
        ...rest,
        // `null` limpa o mapeamento (volta para formato padrão/captura).
        ...(mapping === undefined
          ? {}
          : { mapping: mapping === null ? Prisma.DbNull : { ...mapping } }),
      },
    });
  }

  async regenerateToken(id: string) {
    await this.assertExists(id);
    const { token, hash } = newToken();
    const row = await this.prisma.integration.update({
      ...VIEW,
      where: { id },
      data: { tokenHash: hash },
    });
    return { ...row, token };
  }

  async remove(id: string) {
    await this.assertExists(id);
    await this.prisma.integration.delete({ where: { id } });
  }

  /**
   * Recebe um evento externo (qualquer JSON). Sempre guarda o exemplo. Com
   * mapeamento → abre chamado pelo mapeamento; sem mapeamento e com `title`
   * (formato padrão) → como antes; senão só captura (202, sem chamado).
   */
  async ingest(token: string | undefined, payload: unknown): Promise<IngestResult> {
    const integ = token
      ? await this.prisma.integration.findUnique({ where: { tokenHash: hashToken(token) } })
      : null;
    if (!integ || !integ.active) throw new UnauthorizedException('Token de integração inválido.');

    const now = new Date();
    const sample = truncateStrings(payload ?? null);
    const recent = Array.isArray(integ.recentPayloads) ? integ.recentPayloads : [];
    await this.prisma.integration.update({
      where: { id: integ.id },
      data: {
        lastEventAt: now,
        lastPayloadAt: now,
        lastPayload: sample as Prisma.InputJsonValue,
        // ponytail: read-modify-write; eventos simultâneos podem perder um item do histórico (só exemplo).
        recentPayloads: [{ at: now.toISOString(), payload: sample }, ...recent].slice(
          0,
          RECENT_MAX,
        ) as Prisma.InputJsonValue,
      },
    });

    let fields: EventFields;
    if (integ.mapping) {
      const mapping = integ.mapping as unknown as IntegrationMappingDto;
      fields = applyMapping(mapping, payload);
      const status = classifyStatus(mapping, payload);
      if (status?.kind === 'ignore') {
        return { ignored: true, reason: `Status "${status.value}" não abre nem encerra chamado.` };
      }
      if (status?.kind === 'ok') {
        return this.resolveOpen(integ, fields, status.value, mapping.okAction ?? 'RESOLVED');
      }
      if (!fields.title) {
        throw new UnprocessableEntityException(
          'O mapeamento gerou um título vazio para este evento. Revise o campo Título da integração.',
        );
      }
    } else if (hasTitle(payload)) {
      fields = this.parseNative(payload);
    } else {
      return { captured: true };
    }
    return this.openOrAppend(integ, fields);
  }

  /** Formato padrão da 0.17.0 (`title`, `severity`…), validado como antes. */
  private parseNative(payload: unknown): EventFields {
    const dto = plainToInstance(IntegrationEventDto, payload);
    const errors = validateSync(dto, { whitelist: true });
    if (errors.length) {
      throw new BadRequestException(errors.flatMap((e) => Object.values(e.constraints ?? {})));
    }
    return {
      title: dto.title,
      description: dto.description,
      priority: SEVERITY_PRIORITY[dto.severity ?? 'medium'],
      externalId: dto.externalId,
      assetSerial: dto.assetSerial,
    };
  }

  /**
   * Com `externalId` e um chamado ainda aberto da mesma integração, só registra o
   * evento na timeline (dedup); senão abre chamado.
   */
  private async openOrAppend(integ: Integration, f: EventFields): Promise<IngestResult> {
    const externalId = f.externalId?.trim() || null;
    if (externalId) {
      // ponytail: dois eventos idênticos simultâneos podem abrir 2 chamados;
      // lock/unique parcial se isso aparecer na prática.
      const open = await this.prisma.ticket.findFirst({
        where: { integrationId: integ.id, externalId, status: { notIn: [...TERMINAL] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, number: true },
      });
      if (open) {
        await this.events.record(this.prisma, open.id, 'INTEGRATION_EVENT', {
          integration: integ.name,
          title: f.title,
          description: f.description ?? null,
          priority: f.priority,
        });
        return { ticketId: open.id, number: open.number, created: false };
      }
    }

    // Ativo só se for do cliente da integração; de outro cliente é ignorado.
    const asset = f.assetSerial
      ? await this.prisma.asset.findFirst({
          where: { clientId: integ.clientId, serialNumber: f.assetSerial },
          select: { id: true, locationId: true },
        })
      : null;

    const ticket = await this.tickets.create({
      title: f.title,
      description: f.description?.trim() || `Evento recebido da integração "${integ.name}".`,
      clientId: integ.clientId,
      categoryId: integ.categoryId,
      priority: f.priority,
      origin: 'INTEGRATION',
      locationId: asset?.locationId ?? null,
      assetIds: asset ? [asset.id] : [],
      integrationId: integ.id,
      externalId,
    });
    return { ticketId: ticket.id, number: ticket.number, created: true };
  }

  /**
   * Equipamento normalizou: encerra o chamado aberto da integração com o mesmo
   * ID externo. Sem ID externo ou sem chamado aberto → ignora (nunca abre).
   */
  private async resolveOpen(
    integ: Integration,
    f: EventFields,
    statusValue: string,
    action: 'RESOLVED' | 'CLOSED',
  ): Promise<IngestResult> {
    const externalId = f.externalId?.trim();
    if (!externalId) {
      return { ignored: true, reason: 'Evento de normalização sem ID externo para achar o chamado.' };
    }
    const open = await this.prisma.ticket.findFirst({
      where: { integrationId: integ.id, externalId, status: { notIn: [...TERMINAL] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, number: true },
    });
    if (!open) return { ignored: true, reason: 'Nenhum chamado aberto para este equipamento.' };

    await this.events.record(this.prisma, open.id, 'INTEGRATION_EVENT', {
      integration: integ.name,
      title: f.title || `Status: ${statusValue}`,
      description: `Equipamento normalizado (status "${statusValue}"); chamado encerrado automaticamente.`,
    });
    await this.tickets.changeStatus(open.id, action);
    return { ticketId: open.id, number: open.number, resolved: true };
  }

  private async assertExists(id: string) {
    const found = await this.prisma.integration.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('Integração não encontrada.');
  }
}
