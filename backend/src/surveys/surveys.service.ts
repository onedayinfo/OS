import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, Ticket, TicketSatisfactionSurvey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { RespondSurveyDto } from './dto/respond-survey.dto.js';

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

  private async mustFindByToken(token: string) {
    const survey = await this.prisma.ticketSatisfactionSurvey.findUnique({
      where: { publicToken: token },
      include: { ticket: { select: { number: true, title: true } } },
    });
    if (!survey) throw new NotFoundException('Pesquisa não encontrada.');
    return survey;
  }

  async findByToken(token: string) {
    const survey = await this.mustFindByToken(token);
    return {
      ticketNumber: survey.ticket.number,
      ticketTitle: survey.ticket.title,
      score: survey.score,
      comment: survey.comment,
      respondedAt: survey.respondedAt,
    };
  }

  async respond(token: string, dto: RespondSurveyDto) {
    const survey = await this.mustFindByToken(token);
    const result = await this.prisma.ticketSatisfactionSurvey.updateMany({
      where: { id: survey.id, respondedAt: null },
      data: { score: dto.score, comment: dto.comment ?? null, respondedAt: new Date() },
    });
    if (result.count === 0) {
      throw new ConflictException('Pesquisa já respondida.');
    }
    return this.findByToken(token);
  }
}
