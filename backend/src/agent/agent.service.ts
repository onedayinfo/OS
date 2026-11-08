import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { AgentDeviceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AgentCodeService } from './agent-code.service.js';
import { syncAsset } from './asset-sync.js';
import { ContractGate } from './contract-gate.service.js';
import { CheckinDto } from './dto/checkin.dto.js';
import { EnrollDto } from './dto/enroll.dto.js';
import { matchDevice } from './match-device.util.js';
import { normalizeSerial } from './serial.util.js';
import { hashToken, newToken } from './token.util.js';

const MAX_PENDING = 50;
const INVENTORY_TTL_MS = 24 * 3600e3;

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly codes: AgentCodeService,
    private readonly gate: ContractGate,
  ) {}

  async enroll(dto: EnrollDto): Promise<{ token: string; status: AgentDeviceStatus }> {
    const client = await this.codes.clientByCode(dto.code);
    if (!client) throw new UnauthorizedException('Código de instalação inválido.');
    if (!(await this.gate.hasValidContract(client.id)))
      throw new ForbiddenException('O cliente não possui contrato ativo.');

    const serial = normalizeSerial(dto.serialNumber);
    const serialKey = serial ?? '';
    const existing = await this.prisma.agentDevice.findMany({
      where: { clientId: client.id, machineGuid: dto.machineGuid },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, serialKey: true, status: true },
    });
    const m = matchDevice(existing, serialKey);
    const { token, hash } = newToken();
    const info = {
      hostname: dto.hostname,
      manufacturer: dto.manufacturer,
      model: dto.model,
      ip: dto.ip,
      mac: dto.mac,
      agentVersion: dto.agentVersion,
    };

    if (m.kind === 'match' || m.kind === 'adopt') {
      const cur = existing.find((d) => d.id === m.id)!;
      if (cur.status === 'IGNORED') throw new ForbiddenException('Dispositivo ignorado.');
      const row = await this.prisma.agentDevice.update({
        where: { id: m.id },
        data: {
          ...info,
          tokenHash: hash,
          ...(m.kind === 'adopt' ? { serialKey, serialNumber: serial } : {}),
        },
      });
      if (cur.status === 'LINKED')
        this.logger.warn(`Reenroll: token do dispositivo ${cur.id} (cliente ${client.id}) substituído.`);
      return { token, status: row.status };
    }

    const pending = await this.prisma.agentDevice.count({
      where: { clientId: client.id, status: 'PENDING' },
    });
    if (pending >= MAX_PENDING)
      throw new ConflictException('Limite de dispositivos aguardando cadastro atingido.');
    const row = await this.prisma.agentDevice.create({
      data: {
        clientId: client.id,
        machineGuid: dto.machineGuid,
        serialKey,
        serialNumber: serial,
        ...info,
        tokenHash: hash,
        status: 'PENDING',
        cloneSuspect: m.kind === 'clone',
      },
    });
    return { token, status: row.status };
  }

  async checkin(token: string, dto: CheckinDto): Promise<{ status: AgentDeviceStatus; wantInventory: boolean }> {
    const dev = await this.prisma.agentDevice.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!dev) throw new UnauthorizedException('Token inválido.');
    if (dev.status === 'IGNORED') throw new ForbiddenException('Dispositivo ignorado.');
    if (!(await this.gate.hasValidContract(dev.clientId)))
      throw new ForbiddenException('O cliente não possui contrato ativo.');

    const now = new Date();
    const row = await this.prisma.agentDevice.update({
      where: { id: dev.id },
      data: {
        lastSeenAt: now,
        hostname: dto.hostname,
        agentVersion: dto.agentVersion,
        ip: dto.ip,
        mac: dto.mac,
        manufacturer: dto.manufacturer,
        model: dto.model,
        ...(dto.inventory
          ? { specs: dto.inventory.specs as any, software: dto.inventory.software as any, inventoryAt: now }
          : {}),
      },
    });
    if (row.status === 'LINKED') await syncAsset(this.prisma, row.id);
    const wantInventory = !row.inventoryAt || now.getTime() - row.inventoryAt.getTime() > INVENTORY_TTL_MS;
    return { status: row.status, wantInventory };
  }
}
