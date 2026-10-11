import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

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
}
