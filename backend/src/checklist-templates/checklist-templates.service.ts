import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateChecklistTemplateDto } from './dto/create-checklist-template.dto.js';
import { UpdateChecklistTemplateDto } from './dto/update-checklist-template.dto.js';

const DEFAULT_ITEMS = [
  'Energia ok',
  'Equipamento funcionando',
  'Local limpo',
  'Cliente orientado',
];

@Injectable()
export class ChecklistTemplatesService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const existing = await this.prisma.checklistTemplate.findFirst({ where: { categoryId: null } });
    if (existing) return;
    await this.prisma.checklistTemplate.create({
      data: {
        categoryId: null,
        name: 'Checklist padrão',
        items: { create: DEFAULT_ITEMS.map((label, order) => ({ label, order })) },
      },
    });
  }

  findAll(categoryId?: string) {
    return this.prisma.checklistTemplate.findMany({
      where: categoryId ? { categoryId } : undefined,
      include: { items: { orderBy: { order: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateChecklistTemplateDto) {
    if (dto.categoryId) {
      const dup = await this.prisma.checklistTemplate.findUnique({
        where: { categoryId: dto.categoryId },
      });
      if (dup) throw new BadRequestException('Essa categoria já tem um checklist.');
    }
    return this.prisma.checklistTemplate.create({
      data: {
        categoryId: dto.categoryId ?? null,
        name: dto.name,
        items: { create: dto.items.map((i, idx) => ({ label: i.label, order: i.order ?? idx })) },
      },
      include: { items: { orderBy: { order: 'asc' } } },
    });
  }

  async update(id: string, dto: UpdateChecklistTemplateDto) {
    const found = await this.prisma.checklistTemplate.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Checklist não encontrado.');

    if (dto.name !== undefined || dto.active !== undefined) {
      await this.prisma.checklistTemplate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });
    }

    // Só adiciona/renomeia — nunca remove (um item já respondido não some).
    if (dto.items) {
      for (const [idx, item] of dto.items.entries()) {
        if (item.id) {
          await this.prisma.checklistTemplateItem.update({
            where: { id: item.id },
            data: { label: item.label, order: item.order ?? idx },
          });
        } else {
          await this.prisma.checklistTemplateItem.create({
            data: { templateId: id, label: item.label, order: item.order ?? idx },
          });
        }
      }
    }

    return this.prisma.checklistTemplate.findUnique({
      where: { id },
      include: { items: { orderBy: { order: 'asc' } } },
    });
  }

  /** Resolve o template ativo pra uma categoria; cai no padrão (`categoryId: null`). */
  async resolveForCategory(categoryId: string | null): Promise<{ id: string } | null> {
    if (categoryId) {
      const specific = await this.prisma.checklistTemplate.findFirst({
        where: { categoryId, active: true },
      });
      if (specific) return specific;
    }
    return this.prisma.checklistTemplate.findFirst({ where: { categoryId: null, active: true } });
  }
}
