import { EvolutionStatusService } from './evolution-status.service.js';

const cfg: Record<string, string | undefined> = {
  'whatsapp.evolution.url': 'http://evolution-api:8080/',
  'whatsapp.evolution.apiKey': 'k',
  'whatsapp.evolution.instance': 'os',
};
const settings = (over: Record<string, string | undefined> = {}) => ({
  get: vi.fn().mockImplementation((key: string) => Promise.resolve({ ...cfg, ...over }[key])),
});
const reply = (body: unknown, ok = true) => vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) });

afterEach(() => vi.unstubAllGlobals());

describe('EvolutionStatusService', () => {
  it('sem configuração → configured=false', async () => {
    const s = new EvolutionStatusService(settings({ 'whatsapp.evolution.url': undefined }) as any);
    expect(await s.check()).toMatchObject({ configured: false, state: 'not_configured' });
  });

  it('conectado: state=open, sem aviso', async () => {
    const fetchMock = reply({ instance: { instanceName: 'os', state: 'open' } });
    vi.stubGlobal('fetch', fetchMock);
    const r = await new EvolutionStatusService(settings() as any).check();
    expect(r).toEqual({ configured: true, state: 'open', disconnectedSince: null });
    expect(fetchMock.mock.calls[0][0]).toBe('http://evolution-api:8080/instance/connectionState/os');
    expect(fetchMock.mock.calls[0][1].headers.apikey).toBe('k');
  });

  it('inalcançável marca disconnectedSince e mantém o instante original; reconectar limpa', async () => {
    const s = new EvolutionStatusService(settings() as any);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const a = await s.check();
    expect(a.state).toBe('unreachable');
    expect(a.disconnectedSince).toBeTruthy();
    const b = await s.check();
    expect(b.disconnectedSince).toBe(a.disconnectedSince);
    vi.stubGlobal('fetch', reply({ instance: { state: 'open' } }));
    expect((await s.check()).disconnectedSince).toBeNull();
  });

  it('qr devolve base64/pairingCode quando existem', async () => {
    vi.stubGlobal('fetch', reply({ base64: 'data:image/png;base64,AAA', pairingCode: 'ABCD-1234', count: 1 }));
    expect(await new EvolutionStatusService(settings() as any).qr()).toEqual({
      base64: 'data:image/png;base64,AAA',
      pairingCode: 'ABCD-1234',
    });
  });
});
