import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateWarehouseDto } from './dto/create-warehouse.dto.js';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto.js';
import { ListStockBalancesDto } from './dto/list-stock-balances.dto.js';

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
}
