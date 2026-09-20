import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateWarehouseDto } from './dto/create-warehouse.dto.js';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto.js';
import { ListStockBalancesDto } from './dto/list-stock-balances.dto.js';
import { CreateStockEntryDto } from './dto/create-stock-entry.dto.js';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto.js';
import { CreateMaterialUsageDto } from './dto/create-material-usage.dto.js';

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  listWarehouses() {
    return this.prisma.warehouse.findMany({ orderBy: { name: 'asc' } });
  }

  createWarehouse(dto: CreateWarehouseDto) {
    return this.prisma.warehouse.create({ data: { name: dto.name } });
  }

  private async mustFindWarehouse(id: string) {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!warehouse) throw new NotFoundException('Depósito não encontrado.');
    return warehouse;
  }

  async updateWarehouse(id: string, dto: UpdateWarehouseDto) {
    const warehouse = await this.mustFindWarehouse(id);
    if (dto.active === false) {
      const hasStock = await this.prisma.stockBalance.findFirst({
        where: { warehouseId: id, quantity: { gt: 0 } },
      });
      if (hasStock) throw new BadRequestException('Zere o saldo do depósito antes de desativar.');
    }
    return this.prisma.warehouse.update({
      where: { id },
      data: { name: dto.name ?? warehouse.name, active: dto.active ?? warehouse.active },
    });
  }

  async listBalances(filter: ListStockBalancesDto) {
    const where: Prisma.StockBalanceWhereInput = {};
    if (filter.warehouseId) where.warehouseId = filter.warehouseId;
    if (filter.catalogItemId) where.catalogItemId = filter.catalogItemId;
    const balances = await this.prisma.stockBalance.findMany({
      where,
      include: {
        catalogItem: { select: { id: true, name: true, unit: true } },
        warehouse: { select: { id: true, name: true } },
      },
    });
    const withFlag = balances.map((b) => ({
      ...b,
      belowMinimum: b.minQuantity != null && b.quantity < b.minQuantity,
    }));
    return filter.belowMinimum === 'true' ? withFlag.filter((b) => b.belowMinimum) : withFlag;
  }

  updateMinQuantity(catalogItemId: string, warehouseId: string, minQuantity: number | null) {
    return this.prisma.stockBalance.upsert({
      where: { catalogItemId_warehouseId: { catalogItemId, warehouseId } },
      create: { catalogItemId, warehouseId, minQuantity },
      update: { minQuantity },
    });
  }

  private async mustFindCatalogItem(id: string) {
    const item = await this.prisma.catalogItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Item de catálogo não encontrado.');
    return item;
  }

  async createEntry(dto: CreateStockEntryDto, createdById: string) {
    const item = await this.mustFindCatalogItem(dto.catalogItemId);
    if (item.type !== 'PRODUCT') {
      throw new BadRequestException('Só itens do tipo PRODUCT participam de estoque.');
    }
    await this.mustFindWarehouse(dto.warehouseId);

    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.stockEntry.create({
        data: {
          catalogItemId: dto.catalogItemId,
          warehouseId: dto.warehouseId,
          quantity: dto.quantity,
          unitCost: dto.unitCost,
          notes: dto.notes ?? null,
          createdById,
        },
      });
      const balance = await tx.stockBalance.findUnique({
        where: { catalogItemId_warehouseId: { catalogItemId: dto.catalogItemId, warehouseId: dto.warehouseId } },
      });
      const currentQty = balance?.quantity ?? 0;
      const currentAvg = balance?.avgCost ?? 0;
      const newQty = currentQty + dto.quantity;
      const newAvg =
        currentQty === 0 ? dto.unitCost : (currentQty * currentAvg + dto.quantity * dto.unitCost) / newQty;
      await tx.stockBalance.upsert({
        where: { catalogItemId_warehouseId: { catalogItemId: dto.catalogItemId, warehouseId: dto.warehouseId } },
        create: { catalogItemId: dto.catalogItemId, warehouseId: dto.warehouseId, quantity: dto.quantity, avgCost: dto.unitCost },
        update: { quantity: newQty, avgCost: newAvg },
      });
      return entry;
    });
  }

  async createTransfer(dto: CreateStockTransferDto, createdById: string) {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('Origem e destino não podem ser o mesmo depósito.');
    }
    const item = await this.mustFindCatalogItem(dto.catalogItemId);
    if (item.type !== 'PRODUCT') {
      throw new BadRequestException('Só itens do tipo PRODUCT participam de estoque.');
    }
    await this.mustFindWarehouse(dto.fromWarehouseId);
    await this.mustFindWarehouse(dto.toWarehouseId);

    return this.prisma.$transaction(async (tx) => {
      const fromBalance = await tx.stockBalance.findUnique({
        where: { catalogItemId_warehouseId: { catalogItemId: dto.catalogItemId, warehouseId: dto.fromWarehouseId } },
      });
      if (!fromBalance || fromBalance.quantity < dto.quantity) {
        throw new BadRequestException('Saldo insuficiente no depósito de origem.');
      }
      await tx.stockBalance.update({
        where: { catalogItemId_warehouseId: { catalogItemId: dto.catalogItemId, warehouseId: dto.fromWarehouseId } },
        data: { quantity: { decrement: dto.quantity } },
      });
      const toBalance = await tx.stockBalance.findUnique({
        where: { catalogItemId_warehouseId: { catalogItemId: dto.catalogItemId, warehouseId: dto.toWarehouseId } },
      });
      const currentQty = toBalance?.quantity ?? 0;
      const currentAvg = toBalance?.avgCost ?? 0;
      const newQty = currentQty + dto.quantity;
      const newAvg =
        currentQty === 0 ? fromBalance.avgCost : (currentQty * currentAvg + dto.quantity * fromBalance.avgCost) / newQty;
      await tx.stockBalance.upsert({
        where: { catalogItemId_warehouseId: { catalogItemId: dto.catalogItemId, warehouseId: dto.toWarehouseId } },
        create: { catalogItemId: dto.catalogItemId, warehouseId: dto.toWarehouseId, quantity: dto.quantity, avgCost: fromBalance.avgCost },
        update: { quantity: newQty, avgCost: newAvg },
      });
      return tx.stockTransfer.create({
        data: {
          catalogItemId: dto.catalogItemId,
          fromWarehouseId: dto.fromWarehouseId,
          toWarehouseId: dto.toWarehouseId,
          quantity: dto.quantity,
          notes: dto.notes ?? null,
          createdById,
        },
      });
    });
  }

  async registerMaterialUsage(ticketId: string, dto: CreateMaterialUsageDto, createdById: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Chamado não encontrado.');
    if (ticket.status === 'CLOSED') {
      throw new BadRequestException('Chamado fechado não aceita novo material.');
    }
    const item = await this.mustFindCatalogItem(dto.catalogItemId);
    if (item.type !== 'PRODUCT') {
      throw new BadRequestException('Só itens do tipo PRODUCT participam de estoque.');
    }

    return this.prisma.$transaction(async (tx) => {
      const balance = await tx.stockBalance.findUnique({
        where: { catalogItemId_warehouseId: { catalogItemId: dto.catalogItemId, warehouseId: dto.warehouseId } },
      });
      if (!balance || balance.quantity < dto.quantity) {
        throw new BadRequestException('Saldo insuficiente no depósito informado.');
      }
      await tx.stockBalance.update({
        where: { catalogItemId_warehouseId: { catalogItemId: dto.catalogItemId, warehouseId: dto.warehouseId } },
        data: { quantity: { decrement: dto.quantity } },
      });
      return tx.ticketMaterialUsage.create({
        data: {
          ticketId,
          catalogItemId: dto.catalogItemId,
          warehouseId: dto.warehouseId,
          quantity: dto.quantity,
          unitCost: balance.avgCost,
          createdById,
        },
      });
    });
  }

  listMaterialUsages(ticketId: string) {
    return this.prisma.ticketMaterialUsage.findMany({
      where: { ticketId },
      include: {
        catalogItem: { select: { id: true, name: true, unit: true } },
        warehouse: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
