import { Injectable } from '@nestjs/common';
import type { Prisma, TicketEventType } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

/** Aceita tanto o cliente normal quanto o transacional. */
type PrismaLike = PrismaService | Prisma.TransactionClient;

@Injectable()
export class TicketEventsService {
  /** Grava um `TicketEvent`. `data` default `{}`. */
  record(
    client: PrismaLike,
    ticketId: string,
    type: TicketEventType,
    data: unknown = {},
    actorId?: string,
  ) {
    return client.ticketEvent.create({
      data: {
        ticketId,
        type,
        data: (data ?? {}) as Prisma.InputJsonValue,
        actorId: actorId ?? null,
      },
    });
  }
}
