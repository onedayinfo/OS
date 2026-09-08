import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCategoryDto) {
    return this.prisma.category.create({ data: { name: dto.name } });
  }

  /** Só categorias ativas: o portal usa esta lista no form de abrir chamado. */
  findAll() {
    return this.prisma.category.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const found = await this.prisma.category.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Categoria não encontrada.');
    return this.prisma.category.update({ where: { id }, data: dto });
  }
}
