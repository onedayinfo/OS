import { BadGatewayException } from '@nestjs/common';
import { EvolutionGroupsService } from './evolution-groups.service.js';

const G = (body: unknown) => ({ ok: true, status: 200, body });
const BODY = [
  { id: '120363000000000002@g.us', subject: 'Zeta Suporte', size: 7 },
  { id: '120363000000000001@g.us', subject: 'Acme TI', participants: [{}, {}, {}] },
];

function make(linked: any[] = [], config: any = { url: 'u', apiKey: 'k', instance: 'os' }) {
  const pending: Array<(r: any) => void> = [];
  const evo = {
    config: vi.fn().mockResolvedValue(config),
    request: vi.fn().mockImplementation(() => new Promise((res) => pending.push(res))),
  };
  const prisma = { whatsappGroup: { findMany: vi.fn().mockResolvedValue(linked) } };
  const svc = new EvolutionGroupsService(evo as any, prisma as any);
  // resolve a requisição pendente mais antiga e espera a atualização terminar
  const resolve = async (r: any) => {
    await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
    pending.shift()!(r);
    await vi.waitFor(() => expect((svc as any).inflight).toBeNull());
  };
  return { svc, evo, prisma, resolve };
}

afterEach(() => vi.useRealTimers());

describe('EvolutionGroupsService', () => {
  it('sem cache: responde loading na hora, uma só requisição (single-flight), depois entrega ordenado e vinculado', async () => {
    const { svc, evo, resolve } = make([{ externalId: '120363000000000001@g.us', client: { id: 'c1', name: 'Acme' } }]);
    const rs = await Promise.all([svc.list(), svc.list(), svc.list()]);
    for (const r of rs) expect(r).toMatchObject({ groups: [], loading: true, refreshing: true, updatedAt: null, error: null });
    await vi.waitFor(() => expect(evo.request).toHaveBeenCalledTimes(1));
    expect(evo.request.mock.calls[0].slice(0, 2)).toEqual(['GET', '/group/fetchAllGroups/os?getParticipants=false']);
    expect(evo.request.mock.calls[0][3]).toBe(120000);

    await resolve(G(BODY));
    const out = await svc.list();
    expect(out).toMatchObject({ loading: false, refreshing: false, error: null });
    expect(out.updatedAt).toEqual(expect.any(String));
    expect(out.groups).toEqual([
      { id: '120363000000000001@g.us', name: 'Acme TI', size: 3, linkedClientId: 'c1', linkedClientName: 'Acme' },
      { id: '120363000000000002@g.us', name: 'Zeta Suporte', size: 7, linkedClientId: null, linkedClientName: null },
    ]);
    expect(evo.request).toHaveBeenCalledTimes(1);
  });

  it('cache fresco: nenhuma requisição nova; vínculo é recalculado a cada chamada', async () => {
    const { svc, evo, prisma, resolve } = make();
    await svc.list();
    await resolve(G(BODY));
    prisma.whatsappGroup.findMany.mockResolvedValue([{ externalId: '120363000000000002@g.us', client: { id: 'c9', name: 'Novo' } }]);
    const out = await svc.list();
    expect(out.groups.find((g) => g.id === '120363000000000002@g.us')?.linkedClientName).toBe('Novo');
    expect(evo.request).toHaveBeenCalledTimes(1);
  });

  it('cache velho: devolve o antigo na hora e dispara atualização', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-11T10:00:00Z'));
    const { svc, evo, resolve } = make();
    await svc.list();
    await resolve(G(BODY));
    vi.setSystemTime(new Date('2026-10-11T10:11:00Z'));
    const out = await svc.list();
    expect(out.groups).toHaveLength(2);
    expect(out).toMatchObject({ loading: false, refreshing: true });
    await vi.waitFor(() => expect(evo.request).toHaveBeenCalledTimes(2));
  });

  it('falha mantém o cache e informa o erro (status 0 x HTTP); sucesso posterior limpa', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-11T10:00:00Z'));
    const { svc, resolve } = make();
    await svc.list();
    await resolve(G(BODY));
    vi.setSystemTime(new Date('2026-10-11T10:11:00Z'));
    await svc.list();
    await resolve({ ok: false, status: 0, body: null });
    const out = await svc.list(); // cache continua velho: nova tentativa em segundo plano
    expect(out.groups).toHaveLength(2);
    expect(out.error).toBe('Evolution inalcançável ou demorou demais.');
    await resolve({ ok: false, status: 500, body: null });
    expect((await svc.forceRefresh()).error).toBe('A Evolution respondeu HTTP 500.');
    await resolve(G(BODY));
    expect((await svc.list()).error).toBeNull();
  });

  it('exceção na requisição vira erro genérico, sem rejeitar', async () => {
    const { svc, evo } = make();
    evo.request.mockRejectedValue(new Error('boom'));
    await svc.list();
    await vi.waitFor(async () => expect((await svc.list()).error).toBe('Falha ao consultar a Evolution.'));
  });

  it('não configurada → BadGatewayException', async () => {
    const { svc, evo } = make([], null);
    await expect(svc.list()).rejects.toBeInstanceOf(BadGatewayException);
    await expect(svc.list()).rejects.toThrow(/não configurada/i);
    await expect(svc.forceRefresh()).rejects.toBeInstanceOf(BadGatewayException);
    expect(evo.request).not.toHaveBeenCalled();
  });

  it('forceRefresh: em andamento não inicia segunda; sem andamento inicia', async () => {
    const { svc, evo, resolve } = make();
    await svc.list();
    await svc.forceRefresh();
    await vi.waitFor(() => expect(evo.request).toHaveBeenCalledTimes(1));
    await resolve(G(BODY));
    const out = await svc.forceRefresh();
    expect(out.refreshing).toBe(true);
    await vi.waitFor(() => expect(evo.request).toHaveBeenCalledTimes(2));
  });

  it('warmUp: inicia sem cache, engole erros, não inicia com cache fresco', async () => {
    const { svc, evo, resolve } = make();
    svc.warmUp();
    await vi.waitFor(() => expect(evo.request).toHaveBeenCalledTimes(1));
    await resolve(G(BODY));
    svc.warmUp();
    await new Promise((r) => setTimeout(r, 5));
    expect(evo.request).toHaveBeenCalledTimes(1);

    const bad = make();
    bad.evo.config.mockRejectedValue(new Error('x'));
    expect(() => bad.svc.warmUp()).not.toThrow();
    await new Promise((r) => setTimeout(r, 5));
    expect(bad.evo.request).not.toHaveBeenCalled();
  });

  it('formatos estranhos: ignora não-grupo/nulos, usa name/remoteJid, nome vazio cai para o id', async () => {
    const { svc, resolve } = make();
    await svc.list();
    await resolve(
      G([
        { id: '5519999991234@s.whatsapp.net', subject: 'contato' },
        { subject: 'sem id' },
        null,
        { remoteJid: '120363000000000009@g.us', name: 'Outro formato' },
        { id: 'a@g.us', subject: '', name: '' },
        { id: 'b@g.us', subject: '  ', name: 'Nome B' },
      ]),
    );
    expect((await svc.list()).groups.map((g) => [g.name, g.size])).toEqual([
      ['a@g.us', null],
      ['Nome B', null],
      ['Outro formato', null],
    ]);
  });

  it('corpo vazio → lista vazia', async () => {
    const { svc, resolve } = make();
    await svc.list();
    await resolve(G(null));
    expect(await svc.list()).toMatchObject({ groups: [], loading: false, updatedAt: expect.any(String) });
  });

  it('trocar a instância invalida o cache: sem grupos, loading, uma só requisição para a nova', async () => {
    const { svc, evo, resolve } = make();
    await svc.list();
    await resolve(G(BODY));
    expect((await svc.list()).groups).toHaveLength(2);
    evo.config.mockResolvedValue({ url: 'u', apiKey: 'k', instance: 'outra' });
    const out = await svc.list();
    expect(out).toMatchObject({ groups: [], loading: true, updatedAt: null });
    await svc.list();
    await vi.waitFor(() => expect(evo.request).toHaveBeenCalledTimes(2));
    expect(evo.request.mock.calls[1][1]).toBe('/group/fetchAllGroups/outra?getParticipants=false');
  });

  it('usa a instância capturada no início da atualização, mesmo que a config mude depois', async () => {
    const { svc, evo, resolve } = make();
    await svc.list();
    await vi.waitFor(() => expect(evo.request).toHaveBeenCalledTimes(1));
    evo.config.mockResolvedValue({ url: 'u', apiKey: 'k', instance: 'outra' });
    await resolve(G(BODY));
    expect((svc as any).cache.instance).toBe('os');
    expect(evo.request.mock.calls[0][1]).toContain('/os?');
  });
});
