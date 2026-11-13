import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { DEFAULT_THRESHOLDS, evaluate, maxSeverity, type Severity, type Suggestion, type Thresholds } from './improvements.js';

interface Candidate { id: string; clientId: string; specs: unknown; lastSeenAt: Date | null }

const DAY = 86_400_000;

@Injectable()
export class ImprovementsService {
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService) {}

  async thresholds(): Promise<Thresholds> {
    const d = DEFAULT_THRESHOLDS;
    const n = async (k: string, def: number) => {
      const v = await this.settings.getNumber(`improvements.${k}`);
      return v != null && v > 0 ? v : def;
    };
    return {
      ramMinGb: await n('ramMinGb', d.ramMinGb),
      diskFreePct: await n('diskFreePct', d.diskFreePct),
      biosMaxYears: await n('biosMaxYears', d.biosMaxYears),
      staleDays: await n('staleDays', d.staleDays),
    };
  }

  /**
   * Sugestões por ativo (id -> lista), em lote (sem N+1). Só entram ativos com dispositivo
   * LINKED, cliente com contrato válido e contato nos últimos `staleDays`.
   */
  async suggestionsFor(assets: Candidate[], now = new Date()): Promise<Map<string, Suggestion[]>> {
    const out = new Map<string, Suggestion[]>();
    if (!assets.length) return out;
    const t = await this.thresholds();
    const [linked, contracts] = await Promise.all([
      this.prisma.agentDevice.findMany({
        where: { assetId: { in: assets.map((a) => a.id) }, status: 'LINKED' },
        select: { assetId: true },
      }),
      this.prisma.contract.findMany({
        where: { clientId: { in: [...new Set(assets.map((a) => a.clientId))] }, status: 'ACTIVE', endDate: { gte: now } },
        select: { clientId: true },
      }),
    ]);
    const linkedIds = new Set(linked.map((d) => d.assetId));
    const okClients = new Set(contracts.map((c) => c.clientId));
    const minSeen = now.getTime() - t.staleDays * DAY;
    for (const a of assets) {
      if (!linkedIds.has(a.id) || !okClients.has(a.clientId)) continue;
      if (!a.lastSeenAt || a.lastSeenAt.getTime() < minSeen) continue;
      const s = evaluate(a.specs, now, t);
      if (s.length) out.set(a.id, s);
    }
    return out;
  }

  /** Acrescenta `improvementCount`/`improvementMax` às linhas da listagem de ativos. */
  async annotate<T extends Candidate>(rows: T[]) {
    const m = await this.suggestionsFor(rows);
    return rows.map((r) => {
      const s = m.get(r.id) ?? [];
      return { ...r, improvementCount: s.length, improvementMax: maxSeverity(s) as Severity | null };
    });
  }

  async inventory(assetId: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true, clientId: true, specs: true, lastSeenAt: true, ip: true, mac: true },
    });
    if (!asset) throw new NotFoundException('Ativo não encontrado.');
    const d = await this.prisma.agentDevice.findUnique({
      where: { assetId },
      select: {
        status: true, hostname: true, agentVersion: true, firstSeenAt: true, lastSeenAt: true,
        ip: true, mac: true, specs: true, software: true,
      },
    });
    if (!d || d.status !== 'LINKED') return { device: null, specs: null, software: [], suggestions: [] };
    const specs = d.specs ?? asset.specs ?? null;
    const lastSeenAt = d.lastSeenAt ?? asset.lastSeenAt;
    const sug = await this.suggestionsFor([{ id: asset.id, clientId: asset.clientId, specs, lastSeenAt }]);
    return {
      device: {
        hostname: d.hostname,
        agentVersion: d.agentVersion,
        firstSeenAt: d.firstSeenAt,
        lastSeenAt,
        ip: d.ip ?? asset.ip,
        mac: d.mac ?? asset.mac,
      },
      specs,
      software: Array.isArray(d.software) ? d.software : [],
      suggestions: sug.get(asset.id) ?? [],
    };
  }

  async overview(clientId?: string) {
    const assets = await this.prisma.asset.findMany({
      where: { agentDevice: { is: { status: 'LINKED' } }, ...(clientId ? { clientId } : {}) },
      select: { id: true, label: true, clientId: true, specs: true, lastSeenAt: true, client: { select: { name: true } } },
      orderBy: { label: 'asc' },
    });
    const m = await this.suggestionsFor(assets);
    const byClient = new Map<string, any>();
    for (const a of assets) {
      const s = m.get(a.id);
      if (!s) continue;
      let c = byClient.get(a.clientId);
      if (!c) {
        c = { clientId: a.clientId, clientName: a.client.name, total: 0, byRule: {} as Record<string, number>, items: [] };
        byClient.set(a.clientId, c);
      }
      c.total += s.length;
      for (const x of s) c.byRule[x.rule] = (c.byRule[x.rule] ?? 0) + 1;
      c.items.push({ assetId: a.id, label: a.label, suggestions: s });
    }
    return { clients: [...byClient.values()].sort((x, y) => x.clientName.localeCompare(y.clientName)) };
  }
}
