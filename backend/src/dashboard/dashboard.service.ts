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
}
