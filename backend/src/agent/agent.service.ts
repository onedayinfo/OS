import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AgentDeviceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AgentCodeService } from './agent-code.service.js';
import { ContractGate } from './contract-gate.service.js';
import { EnrollDto } from './dto/enroll.dto.js';
import { matchDevice } from './match-device.util.js';
import { normalizeSerial } from './serial.util.js';
import { newToken } from './token.util.js';

const MAX_PENDING = 50;

@Injectable()
export class AgentService {
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
}
