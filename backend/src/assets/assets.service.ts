import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { decrypt, encrypt } from '../settings/crypto.util.js';
import { serializeAsset } from './assets.serializer.js';
import { CreateAssetDto } from './dto/create-asset.dto.js';
import { UpdateAssetDto } from './dto/update-asset.dto.js';
import { ListAssetsDto } from './dto/list-assets.dto.js';

type WriteData = Prisma.AssetUncheckedCreateInput;

@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Valida local⊂cliente e tipo existente; devolve os campos comuns já normalizados. */
  private async buildWrite(dto: CreateAssetDto | UpdateAssetDto, current?: { clientId: string }) {
    const data: Partial<WriteData> = {};
    if (dto.clientId !== undefined) data.clientId = dto.clientId;
    if (dto.locationId !== undefined) data.locationId = dto.locationId;
    if (dto.typeId !== undefined) data.typeId = dto.typeId;
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.brand !== undefined) data.brand = dto.brand || null;
    if (dto.model !== undefined) data.model = dto.model || null;
    if (dto.serialNumber !== undefined) data.serialNumber = dto.serialNumber?.trim() || null;
    if (dto.ip !== undefined) data.ip = dto.ip || null;
    if (dto.mac !== undefined) data.mac = dto.mac || null;
    if (dto.notes !== undefined) data.notes = dto.notes || null;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.installedAt !== undefined) data.installedAt = dto.installedAt ? new Date(dto.installedAt) : null;
    if (dto.warrantyEndsAt !== undefined) {
      data.warrantyEndsAt = dto.warrantyEndsAt ? new Date(dto.warrantyEndsAt) : null;
    }
    if (dto.credentials !== undefined) {
      data.credentialsEnc = dto.credentials
        ? encrypt(JSON.stringify({ username: dto.credentials.username, password: dto.credentials.password }))
        : null;
    }

    const clientId = data.clientId ?? current?.clientId;
    const locationId = data.locationId;
    if (locationId && clientId) {
      const loc = await this.prisma.location.findUnique({ where: { id: locationId } });
      if (!loc) throw new BadRequestException('Local não encontrado.');
      if (loc.clientId !== clientId) {
        throw new BadRequestException('O local informado não pertence ao cliente.');
      }
    }
    if (data.typeId) {
      const t = await this.prisma.assetType.findUnique({ where: { id: data.typeId } });
      if (!t) throw new BadRequestException('Tipo de ativo não encontrado.');
    }
    return data;
  }

  async create(dto: CreateAssetDto) {
    const data = await this.buildWrite(dto);
    try {
      const created = await this.prisma.asset.create({ data: data as WriteData });
      return serializeAsset(created);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new BadRequestException('Já existe um ativo com esse número de série para o cliente.');
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateAssetDto) {
    const current = await this.prisma.asset.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Ativo não encontrado.');
    const data = await this.buildWrite(dto, current);
    try {
      const updated = await this.prisma.asset.update({ where: { id }, data });
      return serializeAsset(updated);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new BadRequestException('Já existe um ativo com esse número de série para o cliente.');
      }
      throw e;
    }
  }

  async findAll(filter: ListAssetsDto) {
    const { page = 1, pageSize = 20, q, clientId, locationId, typeId, status } = filter;
    const where: Prisma.AssetWhereInput = {};
    if (clientId) where.clientId = clientId;
    if (locationId) where.locationId = locationId;
    if (typeId) where.typeId = typeId;
    if (status) where.status = status;
    if (q) {
      where.OR = [
        { label: { contains: q, mode: 'insensitive' } },
        { serialNumber: { contains: q, mode: 'insensitive' } },
        { brand: { contains: q, mode: 'insensitive' } },
        { model: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.asset.findMany({
        where,
        orderBy: { label: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          location: { select: { id: true, name: true } },
          type: { select: { id: true, name: true } },
          client: { select: { id: true, name: true } },
        },
      }),
      this.prisma.asset.count({ where }),
    ]);
    return { data: rows.map(serializeAsset), total, page, pageSize };
  }

  async findOne(id: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: { client: true, location: true, type: true },
    });
    if (!asset) throw new NotFoundException('Ativo não encontrado.');
    const recentTickets = await this.prisma.ticket.findMany({
      where: { assets: { some: { id } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, number: true, title: true, status: true, createdAt: true,
        assignee: { select: { id: true, name: true } },
      },
    });
    return { ...serializeAsset(asset), recentTickets };
  }

  async revealCredentials(id: string): Promise<{ username: string | null; password: string | null }> {
    const asset = await this.prisma.asset.findUnique({ where: { id }, select: { credentialsEnc: true } });
    if (!asset) throw new NotFoundException('Ativo não encontrado.');
    if (!asset.credentialsEnc) return { username: null, password: null };
    const parsed = JSON.parse(decrypt(asset.credentialsEnc)) as { username?: string; password?: string };
    return { username: parsed.username ?? null, password: parsed.password ?? null };
  }
}
