import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, ContractStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateContractDto } from './dto/create-contract.dto.js';
import { UpdateContractDto } from './dto/update-contract.dto.js';
import { ListContractsDto } from './dto/list-contracts.dto.js';

const CONTRACT_INCLUDE = {
  client: { select: { id: true, name: true } },
  locations: { select: { id: true, name: true } },
  assets: { select: { id: true, label: true } },
  slaOverrides: true,
} as const;

@Injectable()
export class ContractsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertScope(clientId: string, locationIds: string[], assetIds: string[]): Promise<void> {
    if (locationIds.length) {
      const locations = await this.prisma.location.findMany({
        where: { id: { in: locationIds } },
        select: { id: true, clientId: true },
      });
      if (locations.length !== locationIds.length) {
        throw new BadRequestException('Um ou mais locais não existem.');
      }
      if (locations.some((l) => l.clientId !== clientId)) {
        throw new BadRequestException('Um ou mais locais não pertencem ao cliente.');
      }
    }
    if (assetIds.length) {
      const assets = await this.prisma.asset.findMany({
        where: { id: { in: assetIds } },
        select: { id: true, clientId: true },
      });
      if (assets.length !== assetIds.length) {
        throw new BadRequestException('Um ou mais ativos não existem.');
      }
      if (assets.some((a) => a.clientId !== clientId)) {
        throw new BadRequestException('Um ou mais ativos não pertencem ao cliente.');
      }
    }
  }

  async create(dto: CreateContractDto) {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end <= start) throw new BadRequestException('endDate precisa ser depois de startDate.');
    if (dto.franchiseAmount <= 0) throw new BadRequestException('franchiseAmount precisa ser maior que zero.');

    const locationIds = dto.locationIds ?? [];
    const assetIds = dto.assetIds ?? [];
    await this.assertScope(dto.clientId, locationIds, assetIds);

    const created = await this.prisma.contract.create({
      data: {
        clientId: dto.clientId,
        name: dto.name,
        startDate: start,
        endDate: end,
        monthlyValue: dto.monthlyValue ?? null,
        franchiseUnit: dto.franchiseUnit,
        franchiseAmount: dto.franchiseAmount,
        preventiveFrequencyMonths: dto.preventiveFrequencyMonths ?? null,
        nextGenerationAt: dto.preventiveFrequencyMonths ? start : null,
        defaultCategoryId: dto.defaultCategoryId ?? null,
        notes: dto.notes ?? null,
        locations: locationIds.length ? { connect: locationIds.map((id) => ({ id })) } : undefined,
        assets: assetIds.length ? { connect: assetIds.map((id) => ({ id })) } : undefined,
        slaOverrides: dto.slaOverrides?.length
          ? { create: dto.slaOverrides.map((s) => ({ priority: s.priority, hours: s.hours })) }
          : undefined,
      },
    });
    return this.findOne(created.id);
  }

  private async mustFind(id: string) {
    const contract = await this.prisma.contract.findUnique({ where: { id } });
    if (!contract) throw new NotFoundException('Contrato não encontrado.');
    return contract;
  }

  async update(id: string, dto: UpdateContractDto) {
    const current = await this.mustFind(id);
    const start = dto.startDate ? new Date(dto.startDate) : current.startDate;
    const end = dto.endDate ? new Date(dto.endDate) : current.endDate;
    if (end <= start) throw new BadRequestException('endDate precisa ser depois de startDate.');
    if (dto.franchiseAmount !== undefined && dto.franchiseAmount <= 0) {
      throw new BadRequestException('franchiseAmount precisa ser maior que zero.');
    }
    if (dto.locationIds !== undefined || dto.assetIds !== undefined) {
      await this.assertScope(current.clientId, dto.locationIds ?? [], dto.assetIds ?? []);
    }

    const data: Prisma.ContractUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.startDate !== undefined) data.startDate = start;
    if (dto.endDate !== undefined) {
      data.endDate = end;
      // Editar a vigência sempre libera um novo aviso de vencimento (spec §4.5/§5).
      data.renewalWarnedAt = null;
    }
    if (dto.monthlyValue !== undefined) data.monthlyValue = dto.monthlyValue;
    if (dto.franchiseUnit !== undefined) data.franchiseUnit = dto.franchiseUnit;
    if (dto.franchiseAmount !== undefined) data.franchiseAmount = dto.franchiseAmount;
    if (dto.preventiveFrequencyMonths !== undefined) {
      data.preventiveFrequencyMonths = dto.preventiveFrequencyMonths;
    }
    if (dto.defaultCategoryId !== undefined) data.defaultCategoryId = dto.defaultCategoryId || null;
    if (dto.notes !== undefined) data.notes = dto.notes;

    await this.prisma.contract.update({ where: { id }, data });

    if (dto.locationIds !== undefined) {
      await this.prisma.contract.update({
        where: { id },
        data: { locations: { set: dto.locationIds.map((lid) => ({ id: lid })) } },
      });
    }
    if (dto.assetIds !== undefined) {
      await this.prisma.contract.update({
        where: { id },
        data: { assets: { set: dto.assetIds.map((aid) => ({ id: aid })) } },
      });
    }
    if (dto.slaOverrides !== undefined) {
      await this.prisma.contractSlaPolicy.deleteMany({ where: { contractId: id } });
      if (dto.slaOverrides.length) {
        await this.prisma.contractSlaPolicy.createMany({
          data: dto.slaOverrides.map((s) => ({ contractId: id, priority: s.priority, hours: s.hours })),
        });
      }
    }

    return this.findOne(id);
  }

  async cancel(id: string) {
    await this.mustFind(id);
    await this.prisma.contract.update({ where: { id }, data: { status: 'CANCELLED' } });
    return this.findOne(id);
  }

  async findAll(filter: ListContractsDto) {
    const where: Prisma.ContractWhereInput = {};
    if (filter.clientId) where.clientId = filter.clientId;
    if (filter.status) where.status = filter.status as ContractStatus;
    const contracts = await this.prisma.contract.findMany({
      where,
      orderBy: { startDate: 'desc' },
      include: CONTRACT_INCLUDE,
    });
    return Promise.all(contracts.map(async (c) => ({ ...c, consumption: await this.consumption(c.id) })));
  }

  async findOne(id: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: CONTRACT_INCLUDE,
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado.');
    return { ...contract, consumption: await this.consumption(id) };
  }

  async consumption(
    contractId: string,
  ): Promise<{ unit: 'VISITS' | 'HOURS'; used: number; franchiseAmount: number; exceeded: boolean }> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { franchiseUnit: true, franchiseAmount: true },
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado.');

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    let used: number;
    if (contract.franchiseUnit === 'VISITS') {
      used = await this.prisma.ticket.count({
        where: { contractId, createdAt: { gte: monthStart, lt: monthEnd } },
      });
    } else {
      const visits = await this.prisma.visit.findMany({
        where: {
          ticket: { contractId },
          laborStartAt: { gte: monthStart, lt: monthEnd },
          laborEndAt: { not: null },
        },
        select: { laborStartAt: true, laborEndAt: true },
      });
      const minutes = visits.reduce(
        (sum, v) => sum + (v.laborEndAt!.getTime() - v.laborStartAt!.getTime()) / 60000,
        0,
      );
      used = Math.round((minutes / 60) * 100) / 100;
    }

    return {
      unit: contract.franchiseUnit,
      used,
      franchiseAmount: contract.franchiseAmount,
      exceeded: used > contract.franchiseAmount,
    };
  }

  async resolveForTicket(
    clientId: string | null,
    locationId: string | null,
    assetIds: string[],
  ): Promise<string | null> {
    if (!clientId || (!locationId && assetIds.length === 0)) return null;
    const contract = await this.prisma.contract.findFirst({
      where: {
        clientId,
        status: 'ACTIVE',
        OR: [
          ...(locationId ? [{ locations: { some: { id: locationId } } }] : []),
          ...(assetIds.length ? [{ assets: { some: { id: { in: assetIds } } } }] : []),
        ],
      },
      orderBy: { startDate: 'desc' },
    });
    return contract?.id ?? null;
  }
}
