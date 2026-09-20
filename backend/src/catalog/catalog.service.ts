import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto.js';
import { UpdateCatalogItemDto } from './dto/update-catalog-item.dto.js';
import { ListCatalogItemsDto } from './dto/list-catalog-items.dto.js';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(filter: ListCatalogItemsDto) {
    const where: Prisma.CatalogItemWhereInput = {};
    if (filter.type) where.type = filter.type;
    if (filter.active !== undefined) where.active = filter.active === 'true';
    return this.prisma.catalogItem.findMany({ where, orderBy: { name: 'asc' } });
  }

  private async mustFind(id: string) {
    const item = await this.prisma.catalogItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Item de catálogo não encontrado.');
    return item;
  }

  findOne(id: string) {
    return this.mustFind(id);
  }

  create(dto: CreateCatalogItemDto) {
    return this.prisma.catalogItem.create({
      data: { name: dto.name, type: dto.type, unit: dto.unit, price: dto.price },
    });
  }

  async update(id: string, dto: UpdateCatalogItemDto) {
    await this.mustFind(id);
    const data: Prisma.CatalogItemUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.unit !== undefined) data.unit = dto.unit;
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.active !== undefined) data.active = dto.active;
    return this.prisma.catalogItem.update({ where: { id }, data });
  }
}
