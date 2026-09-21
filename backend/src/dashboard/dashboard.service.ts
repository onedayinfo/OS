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

  async technicianProductivity(monthStart: Date, monthEnd: Date) {
    const [resolvedTickets, visits] = await Promise.all([
      this.prisma.ticket.findMany({
        where: { resolvedAt: { gte: monthStart, lt: monthEnd }, assigneeId: { not: null } },
        select: { assigneeId: true },
      }),
      this.prisma.visit.findMany({
        where: {
          laborStartAt: { gte: monthStart, lt: monthEnd },
          laborEndAt: { not: null },
        },
        select: { technicianId: true, laborStartAt: true, laborEndAt: true },
      }),
    ]);

    const byTech = new Map<string, { ticketsResolved: number; hoursWorked: number }>();
    for (const t of resolvedTickets) {
      const id = t.assigneeId!;
      const entry = byTech.get(id) ?? { ticketsResolved: 0, hoursWorked: 0 };
      entry.ticketsResolved += 1;
      byTech.set(id, entry);
    }
    for (const v of visits) {
      const hours = (v.laborEndAt!.getTime() - v.laborStartAt!.getTime()) / 3_600_000;
      const entry = byTech.get(v.technicianId) ?? { ticketsResolved: 0, hoursWorked: 0 };
      entry.hoursWorked += hours;
      byTech.set(v.technicianId, entry);
    }

    const ids = [...byTech.keys()];
    if (ids.length === 0) return [];

    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    return ids.map((id) => ({
      technicianId: id,
      name: nameById.get(id) ?? '—',
      ticketsResolved: byTech.get(id)!.ticketsResolved,
      hoursWorked: Math.round(byTech.get(id)!.hoursWorked * 100) / 100,
    }));
  }

  async contractsExceeded() {
    const contracts = await this.contracts.findAll({ status: 'ACTIVE' });
    return contracts
      .filter((c) => c.consumption.exceeded)
      .map((c) => ({
        contractId: c.id,
        name: c.name,
        clientName: c.client.name,
        unit: c.consumption.unit,
        used: c.consumption.used,
        franchiseAmount: c.consumption.franchiseAmount,
      }));
  }
}
