import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaginationDto } from '../common/pagination.dto.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';

/** lowercase + remove `@` inicial: `['@ACME.com','Acme.com.br']` -> `['acme.com','acme.com.br']`. */
function normalizeDomains(domains: string[] | undefined): string[] {
  return (domains ?? []).map((d) => d.trim().toLowerCase().replace(/^@+/, ''));
}

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateClientDto) {
    return this.prisma.client.create({
      data: {
        name: dto.name,
        cnpj: dto.cnpj ?? null,
        notes: dto.notes ?? null,
        emailDomains: normalizeDomains(dto.emailDomains),
      },
    });
  }

  async findAll({ page = 1, pageSize = 20, q }: PaginationDto) {
    const where: Prisma.ClientWhereInput = q
      ? { name: { contains: q, mode: 'insensitive' } }
      : {};
    const [data, total] = await Promise.all([
      this.prisma.client.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  /**
   * Casa o domínio do remetente de um e-mail inbound com um cliente ativo.
   * Uso interno pelo inbound (Fase 9) — não é rota.
   */
  findByEmailDomain(domain: string) {
    return this.prisma.client.findFirst({
      where: { emailDomains: { has: domain.toLowerCase() }, active: true },
    });
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException('Cliente não encontrado.');
    return client;
  }

  async update(id: string, dto: UpdateClientDto) {
    await this.findOne(id);
    const data: Prisma.ClientUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.cnpj !== undefined) data.cnpj = dto.cnpj;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.emailDomains !== undefined) data.emailDomains = normalizeDomains(dto.emailDomains);
    return this.prisma.client.update({ where: { id }, data });
  }

  async setActive(id: string, active: boolean) {
    await this.findOne(id);
    return this.prisma.client.update({ where: { id }, data: { active } });
  }
}
