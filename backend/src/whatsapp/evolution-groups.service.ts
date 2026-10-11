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

export interface GroupsResponse {
  groups: EvolutionGroup[];
  loading: boolean;
  refreshing: boolean;
  updatedAt: string | null;
  error: string | null;
}

interface RawGroup {
  id: string;
  name: string;
  size: number | null;
}

// ponytail: cache em memória por instância (single-tenant)
const FRESH_MS = 10 * 60_000;
// A Evolution real leva ~40 s para listar; o timeout cobre com folga.
const FETCH_TIMEOUT_MS = 120_000;

@Injectable()
export class EvolutionGroupsService {
  private cache: { groups: RawGroup[]; at: number } | null = null;
  private inflight: Promise<void> | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly evo: EvolutionClient,
    private readonly prisma: PrismaService,
  ) {}

  private stale(): boolean {
    return !this.cache || Date.now() - this.cache.at > FRESH_MS;
  }

  /** Responde na hora com o cache; dispara a atualização em segundo plano se vazio/velho. */
  async list(): Promise<GroupsResponse> {
    if (!(await this.evo.config())) throw new BadGatewayException('Evolution não configurada.');
    if (this.stale()) void this.refresh();
    return this.snapshot();
  }

  /** Botão "Atualizar lista": dispara (single-flight) e responde na hora. */
  async forceRefresh(): Promise<GroupsResponse> {
    if (!(await this.evo.config())) throw new BadGatewayException('Evolution não configurada.');
    void this.refresh();
    return this.snapshot();
  }

  /** Pré-carga (ex.: ao parear). Nunca lança. */
  warmUp(): void {
    void (async () => {
      try {
        if ((await this.evo.config()) && this.stale()) void this.refresh();
      } catch {
        /* pré-carga é só otimização */
      }
    })();
  }

  private refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const c = await this.evo.config();
        if (!c) return;
        const r = await this.evo.request(
          'GET',
          `/group/fetchAllGroups/${encodeURIComponent(c.instance)}?getParticipants=false`,
          undefined,
          FETCH_TIMEOUT_MS,
        );
        if (!r.ok) {
          this.lastError = r.status === 0 ? 'Evolution inalcançável ou demorou demais.' : `A Evolution respondeu HTTP ${r.status}.`;
          return;
        }
        this.cache = { groups: parse(r.body), at: Date.now() };
        this.lastError = null;
      } catch {
        this.lastError = 'Falha ao consultar a Evolution.';
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  private async snapshot(): Promise<GroupsResponse> {
    const raw = this.cache?.groups ?? [];
    const linked = raw.length
      ? await this.prisma.whatsappGroup.findMany({
          where: { externalId: { in: raw.map((g) => g.id) } },
          select: { externalId: true, client: { select: { id: true, name: true } } },
        })
      : [];
    const byId = new Map(linked.map((l) => [l.externalId, l.client]));
    const groups = raw
      .map((g) => ({
        ...g,
        linkedClientId: byId.get(g.id)?.id ?? null,
        linkedClientName: byId.get(g.id)?.name ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return {
      groups,
      loading: this.cache === null && this.inflight !== null,
      refreshing: this.inflight !== null,
      updatedAt: this.cache ? new Date(this.cache.at).toISOString() : null,
      error: this.lastError,
    };
  }
}

function parse(body: unknown): RawGroup[] {
  const raw = Array.isArray(body) ? body : [];
  return raw.flatMap((g: any) => {
    const id = g?.id ?? g?.remoteJid ?? g?.jid;
    if (typeof id !== 'string' || !id.endsWith('@g.us')) return [];
    const size = typeof g?.size === 'number' ? g.size : Array.isArray(g?.participants) ? g.participants.length : null;
    return [{ id, name: [g?.subject, g?.name].map((x) => (typeof x === 'string' ? x.trim() : '')).find(Boolean) || id, size }];
  });
}
