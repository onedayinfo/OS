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
  private cache: { groups: RawGroup[]; at: number; instance: string } | null = null;
  private inflight: Promise<void> | null = null;
  private inflightInstance: string | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly evo: EvolutionClient,
    private readonly prisma: PrismaService,
  ) {}

  /** Cache só vale para a instância atual; de outra instância conta como ausente. */
  private cacheFor(instance: string) {
    return this.cache?.instance === instance ? this.cache : null;
  }

  private stale(instance: string): boolean {
    const c = this.cacheFor(instance);
    return !c || Date.now() - c.at > FRESH_MS;
  }

  /** Responde na hora com o cache; dispara a atualização em segundo plano se vazio/velho. */
  async list(): Promise<GroupsResponse> {
    const c = await this.evo.config();
    if (!c) throw new BadGatewayException('Evolution não configurada.');
    if (this.stale(c.instance)) void this.refresh(c.instance);
    return this.snapshot(c.instance);
  }

  /** Botão "Atualizar lista": dispara (single-flight) e responde na hora. */
  async forceRefresh(): Promise<GroupsResponse> {
    const c = await this.evo.config();
    if (!c) throw new BadGatewayException('Evolution não configurada.');
    void this.refresh(c.instance);
    return this.snapshot(c.instance);
  }

  /** Pré-carga (ex.: ao parear). Nunca lança. */
  warmUp(): void {
    void (async () => {
      try {
        const c = await this.evo.config();
        if (c && this.stale(c.instance)) void this.refresh(c.instance);
      } catch {
        /* pré-carga é só otimização */
      }
    })();
  }

  // A instância é capturada uma vez, na chamada: o cache é marcado com a mesma que foi consultada.
  private refresh(instance: string): Promise<void> {
    if (this.inflight) return this.inflightInstance === instance ? this.inflight : this.inflight.then(() => this.refresh(instance));
    this.inflightInstance = instance;
    this.inflight = (async () => {
      try {
        const r = await this.evo.request(
          'GET',
          `/group/fetchAllGroups/${encodeURIComponent(instance)}?getParticipants=false`,
          undefined,
          FETCH_TIMEOUT_MS,
        );
        if (!r.ok) {
          this.lastError = r.status === 0 ? 'Evolution inalcançável ou demorou demais.' : `A Evolution respondeu HTTP ${r.status}.`;
          return;
        }
        this.cache = { groups: parse(r.body), at: Date.now(), instance };
        this.lastError = null;
      } catch {
        this.lastError = 'Falha ao consultar a Evolution.';
      } finally {
        this.inflight = null;
        this.inflightInstance = null;
      }
    })();
    return this.inflight;
  }

  private async snapshot(instance: string): Promise<GroupsResponse> {
    const cache = this.cacheFor(instance);
    const raw = cache?.groups ?? [];
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
      loading: cache === null && this.inflight !== null,
      refreshing: this.inflight !== null,
      updatedAt: cache ? new Date(cache.at).toISOString() : null,
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
