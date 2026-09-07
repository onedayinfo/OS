import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

@Injectable()
export class TicketNumberService {
  /**
   * Próximo número anual, formato `2026-0001`. O `upsert` no `Counter` roda
   * dentro da transação recebida; o lock de linha do Postgres serializa os
   * incrementos concorrentes.
   */
  async next(
    tx: Prisma.TransactionClient,
    // ponytail: ano local — produto é pt-BR/BRT; contador é por ano, sem colisão na virada
    year: number = new Date().getFullYear(),
  ): Promise<string> {
    const counter = await tx.counter.upsert({
      where: { year },
      create: { year, value: 1 },
      update: { value: { increment: 1 } },
    });
    return `${year}-${String(counter.value).padStart(4, '0')}`;
  }
}
