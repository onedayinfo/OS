import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TicketPriority } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateSlaDto } from './dto/update-sla.dto.js';

// Ordem estável para o GET (mais urgente primeiro). Coincide com `priority desc`
// no enum do Prisma (LOW < MEDIUM < HIGH < URGENT).
const PRIORITIES: TicketPriority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];

@Injectable()
export class SlaService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.slaPolicy.findMany({ orderBy: { priority: 'desc' } });
  }

  /**
   * `from + hours*3600_000`. Com `contractId`, checa antes o SLA próprio do
   * contrato (`ContractSlaPolicy`); sem override, cai no `SlaPolicy` global —
   * comportamento idêntico ao de antes quando `contractId` é omitido.
   */
  async dueAt(priority: TicketPriority, from: Date, contractId?: string): Promise<Date> {
    if (contractId) {
      const override = await this.prisma.contractSlaPolicy.findUnique({
        where: { contractId_priority: { contractId, priority } },
      });
      if (override) return new Date(from.getTime() + override.hours * 3600_000);
    }
    const policy = await this.prisma.slaPolicy.findUnique({ where: { priority } });
    if (!policy) {
      throw new NotFoundException(`Política de SLA não encontrada para a prioridade ${priority}.`);
    }
    return new Date(from.getTime() + policy.hours * 3600_000);
  }

  async update(priority: string, dto: UpdateSlaDto) {
    if (!PRIORITIES.includes(priority as TicketPriority)) {
      throw new BadRequestException(`Prioridade inválida: ${priority}.`);
    }
    const where = { priority: priority as TicketPriority };
    const found = await this.prisma.slaPolicy.findUnique({ where });
    if (!found) throw new NotFoundException('Política de SLA não encontrada.');
    return this.prisma.slaPolicy.update({ where, data: { hours: dto.hours } });
  }
}
