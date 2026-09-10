import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaginationDto } from '../common/pagination.dto.js';
import { CreateLocationDto } from './dto/create-location.dto.js';
import { UpdateLocationDto } from './dto/update-location.dto.js';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertClient(clientId: string) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client || client.active === false) {
      throw new ConflictException('Cliente inválido ou inativo.');
    }
  }

  async create(dto: CreateLocationDto) {
    await this.assertClient(dto.clientId);
    try {
      return await this.prisma.location.create({
        data: {
          clientId: dto.clientId,
          name: dto.name,
          address: dto.address ?? null,
          contactName: dto.contactName ?? null,
          contactPhone: dto.contactPhone ?? null,
          accessNotes: dto.accessNotes ?? null,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new ConflictException('Já existe um local com esse nome para o cliente.');
      }
      throw e;
    }
  }

  async findAll(clientId: string | undefined, { page = 1, pageSize = 20, q }: PaginationDto) {
    const where: Prisma.LocationWhereInput = {};
    if (clientId) where.clientId = clientId;
    if (q) where.name = { contains: q, mode: 'insensitive' };
    const [data, total] = await Promise.all([
      this.prisma.location.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.location.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async findOne(id: string) {
    const location = await this.prisma.location.findUnique({ where: { id } });
    if (!location) throw new NotFoundException('Local não encontrado.');
    return location;
  }

  async update(id: string, dto: UpdateLocationDto) {
    await this.findOne(id);
    try {
      return await this.prisma.location.update({ where: { id }, data: dto });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new ConflictException('Já existe um local com esse nome para o cliente.');
      }
      throw e;
    }
  }
}
