import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AssetsService } from '../assets/assets.service.js';
import { syncAsset } from './asset-sync.js';
import { normalizeSerial } from './serial.util.js';
import type { ApproveDeviceDto } from './dto/approve-device.dto.js';
import type { ListDevicesDto } from './dto/list-devices.dto.js';

const TREATED = 'Dispositivo já tratado.';
const HAS_DEVICE = 'O ativo já possui um dispositivo vinculado.';
const clientSel = { select: { id: true, name: true } };

@Injectable()
export class AgentDevicesService {
  constructor(private readonly prisma: PrismaService, private readonly assets: AssetsService) {}

  async list(f: ListDevicesDto) {
    const { page = 1, pageSize = 20, clientId, status } = f;
    const where: Prisma.AgentDeviceWhereInput = {};
    if (clientId) where.clientId = clientId;
    if (status) where.status = status;
    const [rows, total] = await Promise.all([
      this.prisma.agentDevice.findMany({
        where,
        orderBy: [{ firstSeenAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        omit: { tokenHash: true, specs: true, software: true },
        include: { client: clientSel },
      }),
      this.prisma.agentDevice.count({ where }),
    ]);
    // ponytail: 1 consulta por PENDING; ok para a fila (página de 20)
    const data = await Promise.all(
      rows.map(async (d) => {
        if (d.status !== 'PENDING') return d;
        const serial = normalizeSerial(d.serialNumber);
        const hit = serial
          ? await this.prisma.asset.findFirst({
              where: { clientId: d.clientId, serialNumber: serial },
              orderBy: { id: 'asc' },
              select: { id: true, label: true },
            })
          : null;
        return { ...d, suggestedAsset: hit ?? null };
      }),
    );
    return { data, total, page, pageSize };
  }

  async findOne(id: string) {
    const d = await this.prisma.agentDevice.findUnique({
      where: { id },
      omit: { tokenHash: true },
      include: { client: clientSel },
    });
    if (!d) throw new NotFoundException('Dispositivo não encontrado.');
    return d;
  }

  private async get(id: string) {
    const d = await this.prisma.agentDevice.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Dispositivo não encontrado.');
    return d;
  }

  /** Reivindica o dispositivo (PENDING -> LINKED) de forma atômica. */
  private async claim(id: string) {
    const r = await this.prisma.agentDevice.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'LINKED' },
    });
    if (r.count === 0) throw new ConflictException(TREATED);
  }

  private revert(id: string) {
    return this.prisma.agentDevice.updateMany({ where: { id }, data: { status: 'PENDING' } });
  }

  async approve(id: string, dto: ApproveDeviceDto) {
    const d = await this.get(id);
    await this.claim(id);
    let asset: { id: string };
    try {
      asset = await this.assets.create({
        clientId: d.clientId, // sempre o do dispositivo
        locationId: dto.locationId,
        typeId: dto.typeId,
        label: dto.label,
        assignedTo: dto.assignedTo,
        description: dto.description,
        notes: dto.notes,
        brand: d.manufacturer ?? undefined,
        model: d.model ?? undefined,
        serialNumber: normalizeSerial(d.serialNumber) ?? undefined,
        ip: d.ip ?? undefined,
        mac: d.mac ?? undefined,
      });
      await this.prisma.agentDevice.update({ where: { id }, data: { assetId: asset.id } });
    } catch (e) {
      await this.revert(id);
      throw e;
    }
    await syncAsset(this.prisma, id);
    return asset;
  }

  async link(id: string, assetId: string) {
    const d = await this.get(id);
    if (d.status !== 'PENDING') throw new ConflictException(TREATED);
    const a = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!a) throw new NotFoundException('Ativo não encontrado.');
    if (a.clientId !== d.clientId) throw new BadRequestException('O ativo não pertence ao mesmo cliente.');
    if (await this.prisma.agentDevice.findUnique({ where: { assetId } })) throw new ConflictException(HAS_DEVICE);
    await this.claim(id);
    try {
      await this.prisma.agentDevice.update({ where: { id }, data: { assetId } });
    } catch (e) {
      await this.revert(id);
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException(HAS_DEVICE);
      throw e;
    }
    await syncAsset(this.prisma, id);
    return a;
  }

  // checkin já responde 403 para IGNORED: o token deixa de ser útil.
  async ignore(id: string) {
    const r = await this.prisma.agentDevice.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'IGNORED' },
    });
    if (r.count === 0) {
      await this.get(id);
      throw new ConflictException(TREATED);
    }
    return { ok: true };
  }

  async restore(id: string) {
    const r = await this.prisma.agentDevice.updateMany({
      where: { id, status: 'IGNORED' },
      data: { status: 'PENDING' },
    });
    if (r.count === 0) {
      await this.get(id);
      throw new ConflictException('Dispositivo não está ignorado.');
    }
    return { ok: true };
  }
}
