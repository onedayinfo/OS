import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { TicketNumberService } from '../tickets/ticket-number.service.js';
import { TicketEventsService } from '../tickets/ticket-events.service.js';
import { SlaService } from '../sla/sla.service.js';

interface ContractDue {
  id: string;
  clientId: string;
  name: string;
  defaultCategoryId: string | null;
  startDate: Date;
  nextGenerationAt: Date | null;
  preventiveFrequencyMonths: number | null;
  locations: { id: string }[];
  assets: { id: string; locationId: string }[];
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/** Gera, uma vez por dia, os chamados preventivos dos contratos que chegaram na data. */
@Injectable()
export class ContractPreventiveCron {
  private readonly logger = new Logger(ContractPreventiveCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketNumber: TicketNumberService,
    private readonly events: TicketEventsService,
    private readonly sla: SlaService,
  ) {}

  @Cron('0 6 * * *')
  async run(): Promise<void> {
    const due = (await this.prisma.contract.findMany({
      where: {
        status: 'ACTIVE',
        endDate: { gte: new Date() },
        preventiveFrequencyMonths: { not: null },
        nextGenerationAt: { lte: new Date() },
      },
      include: {
        locations: { select: { id: true } },
        assets: { select: { id: true, locationId: true } },
      },
    })) as ContractDue[];

    for (const contract of due) {
      try {
        await this.generateFor(contract);
      } catch (err) {
        this.logger.error(
          `Falha ao gerar preventiva do contrato ${contract.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  private async generateFor(contract: ContractDue): Promise<void> {
    const locationIds = new Set(contract.locations.map((l) => l.id));
    for (const a of contract.assets) locationIds.add(a.locationId);

    for (const locationId of locationIds) {
      const assetIds = contract.assets.filter((a) => a.locationId === locationId).map((a) => a.id);
      const slaDueAt = await this.sla.dueAt('MEDIUM', new Date(), contract.id);

      await this.prisma.$transaction(async (tx) => {
        const number = await this.ticketNumber.next(tx);
        const created = await tx.ticket.create({
          data: {
            number,
            title: `Manutenção preventiva — ${contract.name}`,
            description: `Chamado gerado automaticamente pelo contrato "${contract.name}".`,
            clientId: contract.clientId,
            requesterId: null,
            categoryId: contract.defaultCategoryId,
            priority: 'MEDIUM',
            status: 'OPEN',
            origin: 'CONTRACT',
            locationId,
            contractId: contract.id,
            needsTriage: false,
            slaDueAt,
            ...(assetIds.length ? { assets: { connect: assetIds.map((id) => ({ id })) } } : {}),
          },
        });
        await this.events.record(tx, created.id, 'CREATED', {}, undefined);
      });
    }

    // Avança até o primeiro ciclo futuro: um contrato com startDate retroativo
    // gera um chamado só (o desta execução) em vez de um lote diário.
    let next = contract.nextGenerationAt ?? contract.startDate;
    do {
      next = addMonths(next, contract.preventiveFrequencyMonths!);
    } while (next <= new Date());

    await this.prisma.contract.update({
      where: { id: contract.id },
      data: { nextGenerationAt: next },
    });
  }
}
