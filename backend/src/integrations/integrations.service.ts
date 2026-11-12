import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { TicketPriority } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { TicketEventsService } from '../tickets/ticket-events.service.js';
import { hashToken, newToken } from '../agent/token.util.js';
import type { IntegrationEventDto } from './dto/integration-event.dto.js';
import type { CreateIntegrationDto, UpdateIntegrationDto } from './dto/integration.dto.js';

export const SEVERITY_PRIORITY: Record<string, TicketPriority> = {
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
  urgent: 'URGENT',
};

const TERMINAL = ['RESOLVED', 'CLOSED', 'CANCELLED'] as const;

const VIEW = {
  omit: { tokenHash: true },
  include: {
    client: { select: { id: true, name: true } },
    category: { select: { id: true, name: true } },
  },
} as const;

/** Extrai o token de `Authorization: Bearer <t>` ou `x-webhook-token`. */
export function extractToken(auth?: string, header?: string): string | undefined {
  const m = auth?.match(/^Bearer\s+(.+)$/i);
  return (m?.[1] ?? header)?.trim() || undefined;
}

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
    private readonly events: TicketEventsService,
  ) {}

  findAll() {
    return this.prisma.integration.findMany({ ...VIEW, orderBy: { name: 'asc' } });
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
    return this.prisma.integration.update({ ...VIEW, where: { id }, data: dto });
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
   * Recebe um evento externo. Com `externalId` e um chamado ainda aberto da
   * mesma integração, só registra o evento na timeline (dedup); senão abre chamado.
   */
  async ingest(token: string | undefined, dto: IntegrationEventDto) {
    const integ = token
      ? await this.prisma.integration.findUnique({ where: { tokenHash: hashToken(token) } })
      : null;
    if (!integ || !integ.active) throw new UnauthorizedException('Token de integração inválido.');

    await this.prisma.integration.update({
      where: { id: integ.id },
      data: { lastEventAt: new Date() },
    });

    const externalId = dto.externalId?.trim() || null;
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
          title: dto.title,
          description: dto.description ?? null,
          severity: dto.severity ?? null,
        });
        return { ticketId: open.id, number: open.number, created: false };
      }
    }

    // Ativo só se for do cliente da integração; de outro cliente é ignorado.
    const asset = dto.assetSerial
      ? await this.prisma.asset.findFirst({
          where: { clientId: integ.clientId, serialNumber: dto.assetSerial },
          select: { id: true, locationId: true },
        })
      : null;

    const ticket = await this.tickets.create({
      title: dto.title,
      description: dto.description?.trim() || `Evento recebido da integração "${integ.name}".`,
      clientId: integ.clientId,
      categoryId: integ.categoryId,
      priority: SEVERITY_PRIORITY[dto.severity ?? 'medium'],
      origin: 'INTEGRATION',
      locationId: asset?.locationId ?? null,
      assetIds: asset ? [asset.id] : [],
      integrationId: integ.id,
      externalId,
    });
    return { ticketId: ticket.id, number: ticket.number, created: true };
  }

  private async assertExists(id: string) {
    const found = await this.prisma.integration.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('Integração não encontrada.');
  }
}
