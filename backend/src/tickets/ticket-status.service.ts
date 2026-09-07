import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma, TicketStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

type PrismaLike = PrismaService | Prisma.TransactionClient;

/**
 * Transições permitidas (spec §5.2): livre qualquer→qualquer, exceto sair de
 * CANCELLED/CLOSED, que só voltam para OPEN (reabertura). RESOLVED não é
 * terminal — circula livremente, inclusive para CLOSED e de volta a IN_PROGRESS.
 */
export const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'WAITING_CLIENT', 'RESOLVED', 'CLOSED', 'CANCELLED'],
  IN_PROGRESS: ['OPEN', 'WAITING_CLIENT', 'RESOLVED', 'CLOSED', 'CANCELLED'],
  WAITING_CLIENT: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED'],
  RESOLVED: ['OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'CLOSED', 'CANCELLED'],
  CLOSED: ['OPEN'],
  CANCELLED: ['OPEN'],
};

@Injectable()
export class TicketStatusService {
  /** Lança `BadRequestException` se `from → to` não é permitido. */
  assertTransition(from: TicketStatus, to: TicketStatus): void {
    if (!TICKET_TRANSITIONS[from]?.includes(to)) {
      throw new BadRequestException(`Transição de status inválida: ${from} → ${to}.`);
    }
  }
}

/**
 * Helper de uso interno (comentários / inbound de e-mail): se o chamado está
 * `WAITING_CLIENT`, uma resposta do cliente o traz de volta para `IN_PROGRESS`.
 * No-op caso contrário. Usado pelas Fases 6 e 9.
 */
export async function resolveClientReply(client: PrismaLike, ticketId: string): Promise<void> {
  const ticket = await client.ticket.findUnique({
    where: { id: ticketId },
    select: { status: true },
  });
  if (!ticket || ticket.status !== 'WAITING_CLIENT') return;

  await client.ticket.update({
    where: { id: ticketId },
    data: { status: 'IN_PROGRESS' },
  });
  await client.ticketEvent.create({
    data: {
      ticketId,
      type: 'STATUS_CHANGED',
      data: { from: 'WAITING_CLIENT', to: 'IN_PROGRESS' },
      actorId: null,
    },
  });
}
