import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { hostParaNome } from './host-name.util.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ContractGate } from './contract-gate.service.js';

const STALE_MS = 30 * 24 * 3600 * 1000;

@Injectable()
export class AgentCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gate: ContractGate,
  ) {}

  private async client(clientId: string) {
    const c = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!c) throw new NotFoundException('Cliente não encontrado.');
    return c;
  }

  async summary(clientId: string) {
    const c = await this.client(clientId);
    const count = (where: object) => this.prisma.agentDevice.count({ where: { clientId, ...where } });
    const [linked, pending, ignored, stale, contractValid] = await Promise.all([
      count({ status: 'LINKED' }),
      count({ status: 'PENDING' }),
      count({ status: 'IGNORED' }),
      count({
        status: 'LINKED',
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(Date.now() - STALE_MS) } }],
      }),
      this.gate.hasValidContract(clientId),
    ]);
    // Spec §13: sem contrato válido o cliente fica fora da contagem de "sem contato".
    return {
      code: c.agentEnrollCode ?? null,
      contractValid,
      counts: { linked, pending, ignored, stale: contractValid ? stale : 0 },
    };
  }

  async regenerate(clientId: string) {
    await this.client(clientId);
    const code = randomBytes(16).toString('hex');
    await this.prisma.client.update({ where: { id: clientId }, data: { agentEnrollCode: code } });
    return { code };
  }

  /** MSI único publicado no build; o nome com o código é o que o instalador lê. */
  async installer(clientId: string, forwardedHost?: string, host?: string) {
    const c = await this.client(clientId);
    if (!c.agentEnrollCode) throw new ConflictException('Gere o código de instalação antes de baixar o instalador.');
    const path = process.env.AGENT_MSI_PATH ?? '/app/agent-dist/AgenteOS.msi';
    if (!existsSync(path)) throw new NotFoundException('Instalador ainda não publicado.');
    return { path, filename: `AgenteOS-${[c.agentEnrollCode, hostParaNome(forwardedHost, host)].filter(Boolean).join('-')}.msi` };
  }

  async clientByCode(code: string) {
    return this.prisma.client.findUnique({ where: { agentEnrollCode: code }, select: { id: true } });
  }
}
