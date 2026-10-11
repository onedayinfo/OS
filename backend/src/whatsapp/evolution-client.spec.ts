import { DEFAULT_INSTANCE, EvolutionClient } from './evolution-client.js';

const settings = (vals: Record<string, string | undefined> = {}) => ({
  get: vi.fn().mockImplementation((k: string) => Promise.resolve(vals[k])),
});
const reply = (body: unknown, init: { ok?: boolean; status?: number } = {}) =>
  vi.fn().mockResolvedValue({ ok: init.ok ?? true, status: init.status ?? 200, json: () => Promise.resolve(body) });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('EvolutionClient.config', () => {
  it('ambiente prevalece sobre a tela; instância padrão os; remove barras finais', async () => {
    vi.stubEnv('EVOLUTION_API_URL', 'http://evolution-api:8080//');
    vi.stubEnv('EVOLUTION_API_KEY', 'ENVKEY');
    const c = new EvolutionClient(settings({ 'whatsapp.evolution.url': 'http://outro', 'whatsapp.evolution.apiKey': 'TELA' }) as any);
    expect(await c.config()).toEqual({ url: 'http://evolution-api:8080', apiKey: 'ENVKEY', instance: DEFAULT_INSTANCE });
  });

  it('sem ambiente usa o gravado na tela e respeita a instância configurada', async () => {
    const c = new EvolutionClient(
      settings({ 'whatsapp.evolution.url': 'http://x:8080', 'whatsapp.evolution.apiKey': 'K', 'whatsapp.evolution.instance': 'minha' }) as any,
    );
    expect(await c.config()).toEqual({ url: 'http://x:8080', apiKey: 'K', instance: 'minha' });
  });

  it('falta URL ou chave → null', async () => {
    expect(await new EvolutionClient(settings({ 'whatsapp.evolution.apiKey': 'K' }) as any).config()).toBeNull();
    expect(await new EvolutionClient(settings({ 'whatsapp.evolution.url': 'http://x' }) as any).config()).toBeNull();
  });
});

describe('EvolutionClient.request', () => {
  const cfg = { 'whatsapp.evolution.url': 'http://evo:8080', 'whatsapp.evolution.apiKey': 'K' };

  it('GET envia apikey e não manda corpo', async () => {
    const f = reply([{ name: 'os' }]);
    vi.stubGlobal('fetch', f);
    const r = await new EvolutionClient(settings(cfg) as any).request('GET', '/instance/fetchInstances');
    expect(r).toEqual({ ok: true, status: 200, body: [{ name: 'os' }] });
    expect(f.mock.calls[0][0]).toBe('http://evo:8080/instance/fetchInstances');
    expect(f.mock.calls[0][1].method).toBe('GET');
    expect(f.mock.calls[0][1].headers.apikey).toBe('K');
    expect(f.mock.calls[0][1].body).toBeUndefined();
  });

  it('POST serializa JSON com Content-Type', async () => {
    const f = reply({ ok: 1 }, { status: 201 });
    vi.stubGlobal('fetch', f);
    await new EvolutionClient(settings(cfg) as any).request('POST', '/webhook/set/os', { a: 1 });
    expect(f.mock.calls[0][1].body).toBe('{"a":1}');
    expect(f.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
  });

  it('erro de rede nunca lança: status 0 e mensagem', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await new EvolutionClient(settings(cfg) as any).request('GET', '/x')).toEqual({
      ok: false, status: 0, body: null, error: 'ECONNREFUSED',
    });
  });

  it('corpo que não é JSON vira body null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.reject(new Error('x')) }));
    expect(await new EvolutionClient(settings(cfg) as any).request('GET', '/x')).toEqual({ ok: false, status: 502, body: null });
  });

  it('não configurada → not_configured sem chamar fetch', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await new EvolutionClient(settings() as any).request('GET', '/x')).toEqual({ ok: false, status: 0, body: null, error: 'not_configured' });
    expect(f).not.toHaveBeenCalled();
  });
});
