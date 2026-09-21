import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma, Ticket, TicketSatisfactionSurvey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class SurveysService {
  constructor(private readonly prisma: PrismaService) {}

  async createForTicket(
    tx: Prisma.TransactionClient,
    ticket: Pick<Ticket, 'id' | 'requesterId'>,
  ): Promise<TicketSatisfactionSurvey | null> {
    if (!ticket.requesterId) return null;
    const existing = await tx.ticketSatisfactionSurvey.findUnique({
      where: { ticketId: ticket.id },
    });
    if (existing) return null;
    return tx.ticketSatisfactionSurvey.create({
      data: { ticketId: ticket.id, publicToken: randomBytes(24).toString('hex') },
    });
  }
}
