import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { QuoteNumberService } from './quote-number.service.js';
import { CreateQuoteDto } from './dto/create-quote.dto.js';
import { ListQuotesDto } from './dto/list-quotes.dto.js';

const QUOTE_INCLUDE = {
  client: { select: { id: true, name: true } },
  ticket: { select: { id: true, number: true } },
  category: { select: { id: true, name: true } },
  items: { include: { catalogItem: { select: { id: true, name: true, unit: true } } } },
} as const;

function withTotal<T extends { items: { quantity: number; unitPrice: number }[] }>(quote: T) {
  const total = quote.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  return { ...quote, total };
}

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quoteNumber: QuoteNumberService,
  ) {}

  findAll(filter: ListQuotesDto) {
    const where: Prisma.QuoteWhereInput = {};
    if (filter.clientId) where.clientId = filter.clientId;
    if (filter.ticketId) where.ticketId = filter.ticketId;
    if (filter.status) where.status = filter.status;
    return this.prisma.quote.findMany({ where, include: QUOTE_INCLUDE, orderBy: { createdAt: 'desc' } });
  }

  private async mustFind(id: string) {
    const quote = await this.prisma.quote.findUnique({ where: { id }, include: QUOTE_INCLUDE });
    if (!quote) throw new NotFoundException('Orçamento não encontrado.');
    return quote;
  }

  async findOne(id: string) {
    return withTotal(await this.mustFind(id));
  }

  async create(dto: CreateQuoteDto, createdById: string) {
    if (!dto.ticketId && (!dto.categoryId || !dto.title)) {
      throw new BadRequestException('Orçamento avulso exige categoryId e title.');
    }
    if (dto.ticketId) {
      const ticket = await this.prisma.ticket.findUnique({ where: { id: dto.ticketId } });
      if (!ticket) throw new BadRequestException('Chamado não encontrado.');
      if (ticket.clientId !== dto.clientId) {
        throw new BadRequestException('O chamado não pertence ao cliente informado.');
      }
    }
    const catalogItems = await this.prisma.catalogItem.findMany({
      where: { id: { in: dto.items.map((i) => i.catalogItemId) } },
    });
    if (catalogItems.length !== new Set(dto.items.map((i) => i.catalogItemId)).size) {
      throw new BadRequestException('Um ou mais itens do catálogo não existem.');
    }
    const priceById = new Map(catalogItems.map((c) => [c.id, c.price]));

    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.quoteNumber.next(tx);
      return tx.quote.create({
        data: {
          number,
          clientId: dto.clientId,
          ticketId: dto.ticketId ?? null,
          categoryId: dto.categoryId ?? null,
          title: dto.title ?? null,
          status: 'DRAFT',
          version: 1,
          publicToken: randomBytes(24).toString('hex'),
          validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
          notes: dto.notes ?? null,
          createdById,
          items: {
            create: dto.items.map((i) => ({
              catalogItemId: i.catalogItemId,
              description: i.description ?? null,
              quantity: i.quantity,
              unitPrice: i.unitPrice ?? priceById.get(i.catalogItemId)!,
            })),
          },
        },
      });
    });
    return this.findOne(created.id);
  }
}
