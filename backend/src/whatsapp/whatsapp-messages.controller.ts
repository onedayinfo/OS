import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { dayRange, groupConversations, todaySp } from './conversations.util.js';

@Controller('whatsapp/messages')
@Roles('ADMIN', 'AGENT')
export class WhatsappMessagesController {
  constructor(private readonly prisma: PrismaService) {}

  /** Mensagens de WhatsApp que originaram/foram anexadas a um chamado. */
  @Get()
  byTicket(@Query('ticketId') ticketId?: string) {
    if (!ticketId) throw new BadRequestException('ticketId é obrigatório.');
    return this.prisma.whatsappMessage.findMany({
      where: { ticketId },
      orderBy: { sentAt: 'asc' },
      take: 100,
      select: {
        id: true, senderName: true, senderPhone: true, body: true, sentAt: true,
        group: { select: { name: true } },
      },
    });
  }

  /** Conversas de um dia (padrão: hoje, fuso de São Paulo) agrupadas por cliente > grupo. */
  @Get('conversations')
  async conversations(@Query('date') date?: string) {
    const day = date ?? todaySp();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(dayRange(day).gte.getTime())) {
      throw new BadRequestException('date deve ser AAAA-MM-DD.');
    }
    const messages = await this.prisma.whatsappMessage.findMany({
      where: { sentAt: dayRange(day), group: { active: true } },
      orderBy: { sentAt: 'asc' },
      take: 5000,
      select: {
        id: true, groupId: true, senderName: true, senderPhone: true, type: true, body: true, sentAt: true,
        aiStatus: true, ticket: { select: { id: true, number: true } },
      },
    });
    const suggestions = messages.length
      ? await this.prisma.ticketSuggestion.findMany({
          where: { messageIds: { hasSome: messages.map((m) => m.id) } },
          select: { messageIds: true, status: true },
        })
      : [];
    const suggested = new Map<string, string>();
    for (const sg of suggestions) for (const id of sg.messageIds) suggested.set(id, sg.status);
    const groups = await this.prisma.whatsappGroup.findMany({
      where: { id: { in: [...new Set(messages.map((m) => m.groupId))] } },
      select: { id: true, name: true, externalId: true, client: { select: { id: true, name: true } } },
    });
    return {
      date: day,
      clients: groupConversations(groups, messages.map((m) => ({ ...m, suggestion: suggested.get(m.id) ?? null }))),
    };
  }
}
