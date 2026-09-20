import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

@Injectable()
export class QuoteNumberService {
  /** Sequência própria por ano civil — não compartilha contador com `TicketNumberService`. */
  async next(
    tx: Prisma.TransactionClient,
    year: number = new Date().getFullYear(),
  ): Promise<number> {
    const counter = await tx.quoteCounter.upsert({
      where: { year },
      create: { year, value: 1 },
      update: { value: { increment: 1 } },
    });
    return counter.value;
  }
}
