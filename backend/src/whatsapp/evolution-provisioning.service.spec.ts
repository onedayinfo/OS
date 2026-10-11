import { EvolutionProvisioningService } from './evolution-provisioning.service.js';

const OK = (body: unknown = []) => ({ ok: true, status: 200, body });
const WEBHOOK_URL = 'http://backend:3001/api/whatsapp/webhook';

function make(o: {
  responses?: Record<string, any>;
  settings?: Record<string, string | undefined>;
  state?: string;
  config?: any;
} = {}) {
  const calls: { method: string; path: string; body?: any }[] = [];
  const responses = { ...(o.responses ?? {}) };
  const evo = {
    config: vi.fn().mockResolvedValue(o.config === undefined ? { url: 'http://evolution-api:8080', apiKey: 'KEY123', instance: 'os' } : o.config),
    request: vi.fn().mockImplementation(async (method: string, path: string, body?: any) => {
      calls.push({ method, path, body });
      await Promise.resolve();
      const r = responses[`${method} ${path}`];
      const out = typeof r === 'function' ? r(body, calls.filter((c) => c.method === method && c.path === path).length) : r;
      return out ?? { ok: false, status: 404, body: null };
    }),
  };
  const store: Record<string, string | undefined> = { ...(o.settings ?? {}) };
  const settings = {
    get: vi.fn(async (k: string) => store[k]),
    set: vi.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
  };
  const status = {
    check: vi.fn().mockResolvedValue({ configured: true, state: o.state ?? 'open', disconnectedSince: null }),
    qr: vi.fn().mockResolvedValue({ base64: 'data:image/png;base64,AAA', pairingCode: null }),
  };
  const groups = { warmUp: vi.fn() };
  const svc = new EvolutionProvisioningService(evo as any, settings as any, status as any, groups as any);
  return { groups, svc, calls, store, settings, status, responses, evo };
}

const stepStatus = (r: any) => Object.fromEntries(r.steps.map((s: any) => [s.id, s.status]));

beforeEach(() => {
  vi.stubEnv('EVOLUTION_API_URL', '');
  vi.stubEnv('EVOLUTION_API_KEY', '');
  vi.stubEnv('WEBHOOK_BASE_URL', '');
});

afterEach(() => vi.unstubAllEnvs());

describe('connect()', () => {
  it('tudo certo: instância já existe, webhook gravado com URL/header/eventos exatos, pareado', async () => {
    const { svc, calls, store } = make({ responses: {
      'GET /instance/fetchInstances': OK([{ name: 'os' }]),
      'POST /webhook/set/os': OK({}),
    } });
    const r = await svc.connect();
    expect(stepStatus(r)).toEqual({ reachable: 'ok', instance: 'ok', webhook: 'ok', connection: 'ok' });
    expect(r.qr).toBeNull();
    expect(calls.some((c) => c.path === '/instance/create')).toBe(false);
    const hook = calls.find((c) => c.path === '/webhook/set/os')!;
    expect(hook.body).toEqual({
      webhook: {
        enabled: true,
        url: WEBHOOK_URL,
        byEvents: false,
        base64: false,
        headers: { 'x-webhook-secret': store['whatsapp.webhookSecret'] },
        events: ['MESSAGES_UPSERT'],
      },
    });
    expect(store['whatsapp.webhookSecret']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('WEBHOOK_BASE_URL do ambiente muda a URL do webhook (sem barra final)', async () => {
    vi.stubEnv('WEBHOOK_BASE_URL', 'http://host.docker.internal:3001/');
    const { svc, calls } = make({ responses: { 'GET /instance/fetchInstances': OK([{ name: 'os' }]), 'POST /webhook/set/os': OK({}) } });
    await svc.connect();
    expect(calls.find((c) => c.path === '/webhook/set/os')!.body.webhook.url).toBe('http://host.docker.internal:3001/api/whatsapp/webhook');
  });

  it('instância inexistente é criada com o corpo certo', async () => {
    const { svc, calls } = make({ responses: {
      'GET /instance/fetchInstances': OK([]),
      'POST /instance/create': { ok: true, status: 201, body: {} },
      'POST /webhook/set/os': OK({}),
    } });
    const r = await svc.connect();
    expect(calls.find((c) => c.path === '/instance/create')!.body).toEqual({ instanceName: 'os', qrcode: true, integration: 'WHATSAPP-BAILEYS' });
    expect(stepStatus(r).instance).toBe('ok');
  });

  it('"já em uso" (403) ao criar conta como sucesso', async () => {
    const { svc } = make({ responses: {
      'GET /instance/fetchInstances': OK([]),
      'POST /instance/create': { ok: false, status: 403, body: { response: { message: ['This name "os" is already in use.'] } } },
      'POST /webhook/set/os': OK({}),
    } });
    expect(stepStatus(await svc.connect()).instance).toBe('ok');
  });

  it('falha ao criar a instância (500) para na etapa e deixa o resto pendente', async () => {
    const { svc, calls } = make({ responses: {
      'GET /instance/fetchInstances': OK([]),
      'POST /instance/create': { ok: false, status: 500, body: null },
    } });
    const r = await svc.connect();
    expect(stepStatus(r)).toEqual({ reachable: 'ok', instance: 'error', webhook: 'pending', connection: 'pending' });
    expect(calls.some((c) => c.path.startsWith('/webhook/set'))).toBe(false);
  });

  it('chave recusada (401): erro claro, sem vazar a chave, nada mais é chamado', async () => {
    const { svc, calls } = make({ responses: { 'GET /instance/fetchInstances': { ok: false, status: 401, body: null } } });
    const r = await svc.connect();
    expect(r.steps[0]).toMatchObject({ id: 'reachable', status: 'error' });
    expect(r.steps[0].detail).toMatch(/recusada/);
    expect(JSON.stringify(r)).not.toContain('KEY123');
    expect(calls).toHaveLength(1);
  });

  it('Evolution inalcançável (status 0)', async () => {
    const { svc } = make({ responses: { 'GET /instance/fetchInstances': { ok: false, status: 0, body: null, error: 'ECONNREFUSED' } } });
    expect((await svc.connect()).steps[0].detail).toMatch(/inalcançável/);
  });

  it('não configurada: orienta a definir as variáveis', async () => {
    const { svc } = make({ config: null });
    const r = await svc.connect();
    expect(r.state).toBe('not_configured');
    expect(r.steps[0].detail).toMatch(/EVOLUTION_API_URL/);
  });

  it('segredo já existente não é regenerado', async () => {
    const { svc, settings } = make({
      settings: { 'whatsapp.webhookSecret': 'segredo-antigo' },
      responses: { 'GET /instance/fetchInstances': OK([{ name: 'os' }]), 'POST /webhook/set/os': OK({}) },
    });
    await svc.connect();
    expect(settings.set).not.toHaveBeenCalled();
  });

  it('falha ao gravar o segredo → erro no webhook sem expor o segredo', async () => {
    const { svc, settings } = make({ responses: { 'GET /instance/fetchInstances': OK([{ name: 'os' }]) } });
    settings.set.mockRejectedValue(new Error('Defina APP_ENCRYPTION_KEY'));
    const r = await svc.connect();
    expect(stepStatus(r).webhook).toBe('error');
    expect(r.steps.find((s) => s.id === 'webhook')!.detail).toMatch(/APP_ENCRYPTION_KEY/);
  });

  it('despareado: conexão pendente e devolve o QR; pareado: sem QR', async () => {
    const closed = make({ state: 'close', responses: { 'GET /instance/fetchInstances': OK([{ name: 'os' }]), 'POST /webhook/set/os': OK({}) } });
    const r = await closed.svc.connect();
    expect(stepStatus(r).connection).toBe('pending');
    expect(r.qr).toEqual({ base64: 'data:image/png;base64,AAA', pairingCode: null });
    expect(r.state).toBe('close');
  });

  it('nunca expõe o segredo gerado nem a chave no relatório', async () => {
    const { svc, store } = make({ responses: { 'GET /instance/fetchInstances': OK([{ name: 'os' }]), 'POST /webhook/set/os': OK({}) } });
    const json = JSON.stringify(await svc.connect());
    expect(json).not.toContain(store['whatsapp.webhookSecret']!);
    expect(json).not.toContain('KEY123');
  });

  it('duas chamadas simultâneas são serializadas: a instância é criada uma vez só', async () => {
    const created = { v: false };
    const { svc, calls } = make({});
    const h = svc as any;
    h.evo.request.mockImplementation(async (method: string, path: string, body?: any) => {
      calls.push({ method, path, body });
      await new Promise((r) => setTimeout(r, 5));
      if (method === 'GET' && path === '/instance/fetchInstances') return OK(created.v ? [{ name: 'os' }] : []);
      if (method === 'POST' && path === '/instance/create') { created.v = true; return { ok: true, status: 201, body: {} }; }
      if (method === 'POST' && path === '/webhook/set/os') return OK({});
      return { ok: false, status: 404, body: null };
    });
    await Promise.all([svc.connect(), svc.connect()]);
    expect(calls.filter((c) => c.path === '/instance/create')).toHaveLength(1);
    // a 2ª execução só começa depois da 1ª terminar (último POST do webhook da 1ª antes do 2º fetchInstances)
    const idxSecondList = calls.map((c, i) => (c.path === '/instance/fetchInstances' ? i : -1)).filter((i) => i >= 0)[1];
    const idxFirstHook = calls.findIndex((c) => c.path === '/webhook/set/os');
    expect(idxFirstHook).toBeLessThan(idxSecondList);
  });
});

describe('connect() — create com timeout', () => {
  it('create status 0 mas instância aparece depois: ok, segue para o webhook; timeout 20000', async () => {
    const { svc, evo } = make({ responses: {
      'GET /instance/fetchInstances': (_b: any, n: number) => OK(n === 1 ? [] : [{ name: 'os' }]),
      'POST /instance/create': { ok: false, status: 0, body: null },
      'POST /webhook/set/os': OK({}),
    } });
    const r = await svc.connect();
    expect(stepStatus(r)).toEqual({ reachable: 'ok', instance: 'ok', webhook: 'ok', connection: 'ok' });
    expect(r.steps.find((s) => s.id === 'instance')!.detail).toMatch(/demorou/);
    const create = evo.request.mock.calls.find((c: any[]) => c[1] === '/instance/create')!;
    expect(create[3]).toBe(20000);
  });

  it('create status 0 e instância não listada: erro, seguintes pendentes, sem webhook/set', async () => {
    const { svc, calls } = make({ responses: {
      'GET /instance/fetchInstances': OK([]),
      'POST /instance/create': { ok: false, status: 0, body: null },
    } });
    const r = await svc.connect();
    expect(stepStatus(r)).toEqual({ reachable: 'ok', instance: 'error', webhook: 'pending', connection: 'pending' });
    expect(r.steps.find((s) => s.id === 'instance')!.detail).toBe('A Evolution demorou a responder ao criar a instância; clique em Conectar / Reparar de novo');
    expect(calls.some((c) => c.path.startsWith('/webhook/set'))).toBe(false);
  });
});

describe('setup() (somente leitura)', () => {
  const SECRET = 's3cr3t';
  const hook = (h?: string) => ({ enabled: true, url: WEBHOOK_URL, headers: h === undefined ? {} : { 'x-webhook-secret': h } });

  it('não faz POST; webhook ok com URL, header e segredo iguais (corpo plano ou aninhado)', async () => {
    for (const body of [hook(SECRET), { webhook: hook(SECRET) }]) {
      const { svc, calls, settings } = make({
        settings: { 'whatsapp.webhookSecret': SECRET },
        responses: { 'GET /instance/fetchInstances': OK([{ name: 'os' }]), 'GET /webhook/find/os': OK(body) },
      });
      const r = await svc.setup();
      expect(calls.every((c) => c.method === 'GET')).toBe(true);
      expect(settings.set).not.toHaveBeenCalled();
      expect(stepStatus(r)).toEqual({ reachable: 'ok', instance: 'ok', webhook: 'ok', connection: 'ok' });
      expect(JSON.stringify(r)).not.toContain(SECRET);
    }
  });

  it('header diferente ou ausente: pendente', async () => {
    for (const h of ['outro', undefined]) {
      const { svc } = make({
        settings: { 'whatsapp.webhookSecret': SECRET },
        responses: { 'GET /instance/fetchInstances': OK([{ name: 'os' }]), 'GET /webhook/find/os': OK(hook(h)) },
      });
      const r = await svc.setup();
      expect(stepStatus(r).webhook).toBe('pending');
      expect(JSON.stringify(r)).not.toContain(SECRET);
    }
  });

  it('sem segredo guardado: pendente com detalhe próprio, sem gravar', async () => {
    const { svc, settings } = make({ responses: { 'GET /instance/fetchInstances': OK([{ name: 'os' }]), 'GET /webhook/find/os': OK(hook(SECRET)) } });
    const r = await svc.setup();
    expect(stepStatus(r).webhook).toBe('pending');
    expect(r.steps.find((s) => s.id === 'webhook')!.detail).toMatch(/Sem segredo/);
    expect(settings.set).not.toHaveBeenCalled();
  });

  it('webhook não consultável ou diferente fica pendente (não erro)', async () => {
    const { svc } = make({ responses: { 'GET /instance/fetchInstances': OK([{ name: 'os' }]) } });
    const r = await svc.setup();
    expect(stepStatus(r).webhook).toBe('pending');
    expect(r.steps.find((s) => s.id === 'webhook')!.detail).toMatch(/Conectar/);
  });

  it('instância ausente: pendente, sem criar nada', async () => {
    const { svc, calls } = make({ responses: { 'GET /instance/fetchInstances': OK([]) } });
    const r = await svc.setup();
    expect(stepStatus(r).instance).toBe('pending');
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('config reflete o ambiente', async () => {
    vi.stubEnv('EVOLUTION_API_URL', 'http://evolution-api:8080');
    vi.stubEnv('EVOLUTION_API_KEY', 'KEY123');
    const { svc } = make({ responses: { 'GET /instance/fetchInstances': OK([{ name: 'os' }]) } });
    expect((await svc.setup()).config).toEqual({ urlFromEnv: true, apiKeyFromEnv: true, instance: 'os' });
  });
});

describe('pré-carga da lista de grupos', () => {
  const base = { responses: { 'GET /instance/fetchInstances': OK([{ name: 'os' }]), 'POST /webhook/set/os': OK({}) } };
  it('chama warmUp uma vez quando o WhatsApp está pareado (connect e setup)', async () => {
    const a = make({ ...base, state: 'open' });
    await a.svc.connect();
    expect(a.groups.warmUp).toHaveBeenCalledTimes(1);
    const b = make({ ...base, state: 'open' });
    await b.svc.setup();
    expect(b.groups.warmUp).toHaveBeenCalledTimes(1);
  });
  it('não chama warmUp quando não está pareado', async () => {
    const { svc, groups } = make({ ...base, state: 'close' });
    await svc.connect();
    expect(groups.warmUp).not.toHaveBeenCalled();
  });
});
