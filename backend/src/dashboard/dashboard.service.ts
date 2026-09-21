import { Injectable } from '@nestjs/common';
import type { TicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ContractsService } from '../contracts/contracts.service.js';

const TERMINAL_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED', 'CANCELLED'];

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contracts: ContractsService,
  ) {}

  async ticketsBlock(monthStart: Date, monthEnd: Date) {
    const [open, overdue, recurring, standalone] = await Promise.all([
      this.prisma.ticket.count({ where: { status: { notIn: TERMINAL_STATUSES } } }),
      this.prisma.ticket.count({
        where: { status: { notIn: TERMINAL_STATUSES }, slaDueAt: { lt: new Date() } },
      }),
      this.prisma.ticket.count({
        where: { createdAt: { gte: monthStart, lt: monthEnd }, contractId: { not: null } },
      }),
      this.prisma.ticket.count({
        where: { createdAt: { gte: monthStart, lt: monthEnd }, contractId: null },
      }),
    ]);
    return { open, overdue, recurring, standalone };
  }

  async avgResolutionHours(monthStart: Date, monthEnd: Date): Promise<number | null> {
    const resolved = await this.prisma.ticket.findMany({
      where: { resolvedAt: { gte: monthStart, lt: monthEnd } },
      select: { createdAt: true, resolvedAt: true },
    });
    if (resolved.length === 0) return null;
    const totalHours = resolved.reduce(
      (sum, t) => sum + (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 3_600_000,
      0,
    );
    return Math.round((totalHours / resolved.length) * 100) / 100;
  }
}
