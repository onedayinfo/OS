import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Actor } from '../tickets/tickets.service.js';
import { CreateArticleDto } from './dto/create-article.dto.js';
import { UpdateArticleDto } from './dto/update-article.dto.js';

@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(filter: { q?: string; categoryId?: string; assetTypeId?: string }) {
    const where: Prisma.KnowledgeArticleWhereInput = {};
    if (filter.categoryId) where.categoryId = filter.categoryId;
    if (filter.assetTypeId) where.assetTypeId = filter.assetTypeId;
    if (filter.q) {
      where.OR = [
        { title: { contains: filter.q, mode: 'insensitive' } },
        { body: { contains: filter.q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.knowledgeArticle.findMany({
      where,
      include: { category: true, assetType: true },
      orderBy: { title: 'asc' },
    });
  }

  create(dto: CreateArticleDto, actor: Actor) {
    return this.prisma.knowledgeArticle.create({
      data: {
        title: dto.title,
        body: dto.body,
        categoryId: dto.categoryId ?? null,
        assetTypeId: dto.assetTypeId ?? null,
        createdById: actor.id,
      },
    });
  }

  async findOne(id: string) {
    const article = await this.prisma.knowledgeArticle.findUnique({
      where: { id },
      include: { category: true, assetType: true, attachments: true },
    });
    if (!article) throw new NotFoundException('Artigo não encontrado.');
    return article;
  }

  async update(id: string, dto: UpdateArticleDto) {
    const found = await this.prisma.knowledgeArticle.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Artigo não encontrado.');
    const data: Prisma.KnowledgeArticleUncheckedUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.body !== undefined) data.body = dto.body;
    if (dto.categoryId !== undefined) data.categoryId = dto.categoryId || null;
    if (dto.assetTypeId !== undefined) data.assetTypeId = dto.assetTypeId || null;
    if (dto.active !== undefined) data.active = dto.active;
    return this.prisma.knowledgeArticle.update({ where: { id }, data });
  }
}
