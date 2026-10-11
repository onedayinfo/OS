import { BadGatewayException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EvolutionClient } from './evolution-client.js';

export interface EvolutionGroup {
  id: string;
  name: string;
  size: number | null;
  linkedClientId: string | null;
  linkedClientName: string | null;
}

@Injectable()
export class EvolutionGroupsService {
  constructor(
    private readonly evo: EvolutionClient,
    private readonly prisma: PrismaService,
  ) {}

  async list(): Promise<EvolutionGroup[]> {
    const c = await this.evo.config();
    if (!c) throw new BadGatewayException('Evolution não configurada.');
    const r = await this.evo.request(
      'GET',
      `/group/fetchAllGroups/${encodeURIComponent(c.instance)}?getParticipants=false`,
      undefined,
      15000,
    );
    if (!r.ok) {
      throw new BadGatewayException(r.status === 0 ? 'Evolution inalcançável.' : `A Evolution respondeu HTTP ${r.status}.`);
    }

    const raw = Array.isArray(r.body) ? r.body : [];
    const groups = raw.flatMap((g: any) => {
      const id = g?.id ?? g?.remoteJid ?? g?.jid;
      if (typeof id !== 'string' || !id.endsWith('@g.us')) return [];
      const size = typeof g?.size === 'number' ? g.size : Array.isArray(g?.participants) ? g.participants.length : null;
      return [{ id, name: [g?.subject, g?.name].map((x) => (typeof x === 'string' ? x.trim() : '')).find(Boolean) || id, size }];
    });

    const linked = await this.prisma.whatsappGroup.findMany({
      where: { externalId: { in: groups.map((g) => g.id) } },
      select: { externalId: true, client: { select: { id: true, name: true } } },
    });
    const byId = new Map(linked.map((l) => [l.externalId, l.client]));

    return groups
      .map((g) => ({
        ...g,
        linkedClientId: byId.get(g.id)?.id ?? null,
        linkedClientName: byId.get(g.id)?.name ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }
}
