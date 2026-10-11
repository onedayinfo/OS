import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { SuggestionStatus, TicketPriority } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import type { AcceptSuggestionDto } from './dto/suggestion.dto.js';

export function priorityFromUrgency(u: number): TicketPriority {
  if (u >= 5) return 'URGENT';
  if (u === 4) return 'HIGH';
  if (u === 3) return 'MEDIUM';
  return 'LOW';
}

@Injectable()
export class SuggestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
  ) {}

  list(status: SuggestionStatus = 'OPEN') {
    return this.prisma.ticketSuggestion.findMany({
      where: { status },
      orderBy: [{ urgency: 'desc' }, { createdAt: 'asc' }],
      take: 200,
      include: {
        group: { select: { name: true, externalId: true } },
        client: { select: { id: true, name: true } },
      },
    });
  }

  /** Barreira atômica: só quem muda OPEN → novo status prossegue (clique duplo/2 técnicos). */
  private async claim(id: string, status: 'ACCEPTED' | 'DISCARDED', actorId: string) {
    const r = await this.prisma.ticketSuggestion.updateMany({
      where: { id, status: 'OPEN' },
      data: { status, decidedById: actorId, decidedAt: new Date() },
    });
    if (r.count === 0) throw new ConflictException('Esta sugestão já foi decidida.');
  }

  async accept(id: string, actorId: string, dto: AcceptSuggestionDto) {
    const s = await this.prisma.ticketSuggestion.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Sugestão não encontrada.');
    await this.claim(id, 'ACCEPTED', actorId);
    try {
      const first = await this.prisma.whatsappMessage.findFirst({
        where: { id: { in: s.messageIds } },
        orderBy: { sentAt: 'asc' },
        select: { senderUserId: true },
      });
      const ticket = await this.tickets.create({
        origin: 'WHATSAPP',
        clientId: s.clientId,
        requesterId: first?.senderUserId ?? null,
        title: dto.title?.trim() || s.summary,
        description: s.excerpt,
        categoryId: dto.categoryId ?? null,
        priority: priorityFromUrgency(s.urgency),
      });
      await this.prisma.ticketSuggestion.update({ where: { id }, data: { ticketId: ticket.id } });
      await this.prisma.whatsappMessage.updateMany({ where: { id: { in: s.messageIds } }, data: { ticketId: ticket.id } });
      return ticket;
    } catch (err) {
      await this.prisma.ticketSuggestion.updateMany({
        where: { id, status: 'ACCEPTED', ticketId: null },
        data: { status: 'OPEN', decidedById: null, decidedAt: null },
      });
      throw err;
    }
  }

  async discard(id: string, actorId: string) {
    const s = await this.prisma.ticketSuggestion.findUnique({ where: { id }, select: { id: true } });
    if (!s) throw new NotFoundException('Sugestão não encontrada.');
    await this.claim(id, 'DISCARDED', actorId);
    return { ok: true };
  }
}
