import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateOpportunityDto } from './dto/create-opportunity.dto.js';
import { UpdateOpportunityDto } from './dto/update-opportunity.dto.js';
import { ListOpportunitiesDto } from './dto/list-opportunities.dto.js';
import { ChangeStageDto } from './dto/change-stage.dto.js';

export const OPPORTUNITY_INCLUDE = {
  client: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
  quote: { select: { id: true, number: true, items: { select: { quantity: true, unitPrice: true } } } },
} as const;

function withQuoteTotal<T extends { quote: { items: { quantity: number; unitPrice: number }[] } | null }>(
  opp: T,
) {
  if (!opp.quote) return { ...opp, quote: null };
  const total = opp.quote.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const { items, ...quote } = opp.quote;
  return { ...opp, quote: { ...quote, total } };
}

@Injectable()
export class OpportunitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(filter: ListOpportunitiesDto) {
    const where: Prisma.OpportunityWhereInput = {};
    if (filter.stage) where.stage = filter.stage;
    if (filter.ownerId) where.ownerId = filter.ownerId;
    if (filter.clientId) where.clientId = filter.clientId;
    const list = await this.prisma.opportunity.findMany({
      where,
      include: OPPORTUNITY_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return list.map(withQuoteTotal);
  }

  private async mustFind(id: string) {
    const opp = await this.prisma.opportunity.findUnique({
      where: { id },
      include: { ...OPPORTUNITY_INCLUDE, notes: { orderBy: { createdAt: 'desc' } } },
    });
    if (!opp) throw new NotFoundException('Oportunidade não encontrada.');
    return opp;
  }

  async findOne(id: string) {
    return withQuoteTotal(await this.mustFind(id));
  }

  async create(dto: CreateOpportunityDto) {
    if (!dto.clientId && !dto.leadName) {
      throw new BadRequestException('Informe clientId ou leadName.');
    }
    // clientId prevalece sobre dados de lead quando os dois vêm preenchidos.
    const leadFields = dto.clientId
      ? {}
      : {
          leadName: dto.leadName,
          leadCompany: dto.leadCompany ?? null,
          leadPhone: dto.leadPhone ?? null,
          leadEmail: dto.leadEmail ?? null,
        };
    return this.prisma.opportunity.create({
      data: {
        title: dto.title,
        value: dto.value ?? null,
        ownerId: dto.ownerId,
        clientId: dto.clientId ?? null,
        quoteId: dto.quoteId ?? null,
        ...leadFields,
      },
    });
  }

  async update(id: string, dto: UpdateOpportunityDto) {
    await this.mustFind(id);
    return this.prisma.opportunity.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.value !== undefined && { value: dto.value }),
        ...(dto.ownerId !== undefined && { ownerId: dto.ownerId }),
        ...(dto.leadName !== undefined && { leadName: dto.leadName }),
        ...(dto.leadCompany !== undefined && { leadCompany: dto.leadCompany }),
        ...(dto.leadPhone !== undefined && { leadPhone: dto.leadPhone }),
        ...(dto.leadEmail !== undefined && { leadEmail: dto.leadEmail }),
        ...(dto.quoteId !== undefined && { quoteId: dto.quoteId }),
        ...(dto.nextFollowUpAt !== undefined && {
          nextFollowUpAt: dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : null,
        }),
        ...(dto.nextFollowUpNote !== undefined && { nextFollowUpNote: dto.nextFollowUpNote }),
      },
    });
  }

  async remove(id: string) {
    const opp = await this.mustFind(id);
    if (opp.stage === 'WON') {
      throw new BadRequestException('Não é possível excluir uma oportunidade ganha.');
    }
    await this.prisma.opportunity.delete({ where: { id } });
  }

  async changeStage(id: string, dto: ChangeStageDto) {
    if (dto.stage === 'LOST' && !dto.lostReason) {
      throw new BadRequestException('Informe o motivo da perda.');
    }
    const opp = await this.mustFind(id);
    if (dto.stage === 'WON' && !opp.clientId) {
      return this.prisma.$transaction((tx) => this.winWithoutClient(tx, opp));
    }
    return this.prisma.opportunity.update({
      where: { id },
      data: {
        stage: dto.stage,
        lostReason: dto.stage === 'LOST' ? dto.lostReason : opp.lostReason,
        lostAt: dto.stage === 'LOST' ? new Date() : opp.lostAt,
        wonAt: dto.stage === 'WON' && !opp.wonAt ? new Date() : opp.wonAt,
      },
    });
  }

  private async winWithoutClient(tx: Prisma.TransactionClient, opp: { id: string; leadName: string | null; leadCompany: string | null; leadPhone: string | null; leadEmail: string | null; title: string }) {
    const contactLine = [opp.leadName, opp.leadPhone, opp.leadEmail].filter(Boolean).join(' — ');
    const client = await tx.client.create({
      data: {
        name: opp.leadCompany ?? opp.leadName ?? opp.title,
        notes: contactLine ? `Contato original (CRM): ${contactLine}` : null,
      },
    });
    return tx.opportunity.update({
      where: { id: opp.id },
      data: { clientId: client.id, stage: 'WON', wonAt: new Date() },
    });
  }
}
