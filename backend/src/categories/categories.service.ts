import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCategoryDto) {
    return this.prisma.category.create({
      data: {
        name: dto.name,
        slaOverrides: dto.slaOverrides?.length
          ? { create: dto.slaOverrides.map((s) => ({ priority: s.priority, hours: s.hours })) }
          : undefined,
      },
      include: { slaOverrides: true },
    });
  }

  /** Todas as categorias (ativas e inativas): a config da equipe precisa das inativas para reativar. Os forms de abertura filtram ativas no cliente. */
  findAll() {
    return this.prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: { slaOverrides: true },
    });
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const found = await this.prisma.category.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Categoria não encontrada.');

    const { slaOverrides, ...rest } = dto;
    await this.prisma.category.update({ where: { id }, data: rest });

    if (slaOverrides !== undefined) {
      await this.prisma.categorySlaPolicy.deleteMany({ where: { categoryId: id } });
      if (slaOverrides.length) {
        await this.prisma.categorySlaPolicy.createMany({
          data: slaOverrides.map((s) => ({ categoryId: id, priority: s.priority, hours: s.hours })),
        });
      }
    }

    return this.prisma.category.findUnique({ where: { id }, include: { slaOverrides: true } });
  }
}
