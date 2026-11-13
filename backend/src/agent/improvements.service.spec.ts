import { NotFoundException } from '@nestjs/common';
import { ImprovementsService } from './improvements.service.js';

const now = Date.now();
const fresh = new Date(now - 3600_000);
const old = new Date(now - 30 * 86_400_000);
const lowRam = { ramGb: 4 };

const make = (o: { linked?: string[]; contracts?: string[]; settings?: Record<string, number>; device?: any; asset?: any; assets?: any[] } = {}) => {
  const prisma: any = {
    agentDevice: {
      findMany: vi.fn().mockResolvedValue((o.linked ?? ['a1']).map((assetId) => ({ assetId }))),
      findUnique: vi.fn().mockResolvedValue(o.device ?? null),
    },
    contract: { findMany: vi.fn().mockResolvedValue((o.contracts ?? ['c1']).map((clientId) => ({ clientId }))) },
    asset: {
      findUnique: vi.fn().mockResolvedValue(o.asset === undefined ? { id: 'a1', clientId: 'c1', specs: lowRam, lastSeenAt: fresh } : o.asset),
      findMany: vi.fn().mockResolvedValue(o.assets ?? []),
    },
  };
  const settings: any = { getNumber: vi.fn(async (k: string) => o.settings?.[k]) };
  return { prisma, s: new ImprovementsService(prisma, settings) };
};
const cand = (o: any = {}) => ({ id: 'a1', clientId: 'c1', specs: lowRam, lastSeenAt: fresh, ...o });

describe('ImprovementsService', () => {
  it('sugere para ativo vinculado, com contrato e contato recente', async () => {
    const m = await make().s.suggestionsFor([cand()]);
    expect(m.get('a1')?.[0].rule).toBe('ram-baixa');
  });

  it('não sugere sem contrato válido, sem vínculo LINKED ou com dado velho/sem contato', async () => {
    expect((await make({ contracts: [] }).s.suggestionsFor([cand()])).size).toBe(0);
    expect((await make({ linked: [] }).s.suggestionsFor([cand()])).size).toBe(0);
    expect((await make().s.suggestionsFor([cand({ lastSeenAt: old })])).size).toBe(0);
    expect((await make().s.suggestionsFor([cand({ lastSeenAt: null })])).size).toBe(0);
  });

  it('lê limiares do Setting (staleDays e ramMinGb) e ignora valor inválido', async () => {
    const a = make({ settings: { 'improvements.staleDays': 60 } });
    expect((await a.s.suggestionsFor([cand({ lastSeenAt: old })])).size).toBe(1);
    const b = make({ settings: { 'improvements.ramMinGb': 2, 'improvements.staleDays': -1 } });
    expect((await b.s.suggestionsFor([cand()])).size).toBe(0);
    expect((await b.s.thresholds()).staleDays).toBe(7);
  });

  it('usa uma consulta por tabela (sem N+1)', async () => {
    const a = make({ linked: ['a1', 'a2'] });
    await a.s.suggestionsFor([cand(), cand({ id: 'a2' }), cand({ id: 'a3' })]);
    expect(a.prisma.agentDevice.findMany).toHaveBeenCalledTimes(1);
    expect(a.prisma.contract.findMany).toHaveBeenCalledTimes(1);
  });

  it('annotate acrescenta contagem e severidade máxima', async () => {
    const a = make();
    const [r1, r2] = await a.s.annotate([cand({ specs: { ramGb: 4, discos: [{ nome: 'C:', tamanhoGb: 1, smart: 'Falha' }] } }), cand({ id: 'a9', specs: {} })]);
    expect(r1).toMatchObject({ improvementCount: 2, improvementMax: 'alta' });
    expect(r2).toMatchObject({ improvementCount: 0, improvementMax: null });
  });

  it('inventory: 404 se o ativo não existe', async () => {
    await expect(make({ asset: null }).s.inventory('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('inventory: sem agente -> device null e listas vazias', async () => {
    expect(await make().s.inventory('a1')).toEqual({ device: null, specs: null, software: [], suggestions: [] });
    expect(await make({ device: { status: 'PENDING' } }).s.inventory('a1')).toMatchObject({ device: null });
  });

  it('inventory: com agente devolve device, specs, software e sugestões (sem token)', async () => {
    const device = {
      status: 'LINKED', hostname: 'PC1', agentVersion: '1.0', firstSeenAt: fresh, lastSeenAt: fresh,
      ip: '1.1.1.1', mac: 'aa', specs: lowRam, software: [{ name: 'X', version: '1', publisher: 'Y' }],
    };
    const r: any = await make({ device }).s.inventory('a1');
    expect(r.device).toEqual({ hostname: 'PC1', agentVersion: '1.0', firstSeenAt: fresh, lastSeenAt: fresh, ip: '1.1.1.1', mac: 'aa' });
    expect(r.software).toHaveLength(1);
    expect(r.suggestions[0].rule).toBe('ram-baixa');
  });

  it('inventory: cliente sem contrato mantém inventário mas sem sugestões', async () => {
    const device = { status: 'LINKED', hostname: 'PC1', firstSeenAt: fresh, lastSeenAt: fresh, specs: lowRam, software: null };
    const r: any = await make({ device, contracts: [] }).s.inventory('a1');
    expect(r.suggestions).toEqual([]);
    expect(r.software).toEqual([]);
    expect(r.specs).toEqual(lowRam);
  });

  it('overview agrupa por cliente, conta por regra e só traz ativos com sugestão', async () => {
    const assets = [
      { id: 'a1', label: 'B', clientId: 'c1', specs: lowRam, lastSeenAt: fresh, client: { name: 'Zeta' } },
      { id: 'a2', label: 'A', clientId: 'c1', specs: lowRam, lastSeenAt: fresh, client: { name: 'Zeta' } },
      { id: 'a3', label: 'C', clientId: 'c1', specs: {}, lastSeenAt: fresh, client: { name: 'Zeta' } },
    ];
    const r: any = await make({ linked: ['a1', 'a2', 'a3'], assets }).s.overview('c1');
    expect(r.clients).toHaveLength(1);
    expect(r.clients[0]).toMatchObject({ clientId: 'c1', clientName: 'Zeta', total: 2, byRule: { 'ram-baixa': 2 } });
    expect(r.clients[0].items.map((i: any) => i.assetId)).toEqual(['a1', 'a2']);
  });
});
