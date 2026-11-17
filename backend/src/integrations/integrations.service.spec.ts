import { BadRequestException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { IntegrationsService, extractToken, classifyStatus } from './integrations.service.js';
import { hashToken } from '../agent/token.util.js';

const INTEG = {
  id: 'i1',
  name: 'Zabbix',
  clientId: 'c1',
  categoryId: 'cat1',
  tokenHash: hashToken('tok'),
  active: true,
};

function make(overrides: { integ?: any; open?: any; asset?: any } = {}) {
  const prisma = {
    integration: {
      findUnique: vi.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(where.tokenHash === INTEG.tokenHash ? (overrides.integ ?? INTEG) : null),
      ),
      update: vi.fn().mockResolvedValue({}),
    },
    ticket: { findFirst: vi.fn().mockResolvedValue(overrides.open ?? null) },
    asset: { findFirst: vi.fn().mockResolvedValue(overrides.asset ?? null) },
  };
  const tickets = {
    create: vi.fn().mockResolvedValue({ id: 't9', number: '000009' }),
    changeStatus: vi.fn().mockResolvedValue({}),
  };
  const events = { record: vi.fn().mockResolvedValue({}) };
  const svc = new IntegrationsService(prisma as any, tickets as any, events as any);
  return { svc, prisma, tickets, events };
}

describe('extractToken', () => {
  it('lê Bearer e cai no header alternativo', () => {
    expect(extractToken('Bearer abc')).toBe('abc');
    expect(extractToken('bearer  abc ')).toBe('abc');
    expect(extractToken(undefined, 'xyz')).toBe('xyz');
    expect(extractToken('Basic foo', undefined)).toBeUndefined();
    expect(extractToken(undefined, '  ')).toBeUndefined();
  });
});

describe('IntegrationsService.ingest', () => {
  it('token inválido, ausente ou integração inativa → 401', async () => {
    const { svc } = make();
    await expect(svc.ingest('errado', { title: 'x' })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.ingest(undefined, { title: 'x' })).rejects.toBeInstanceOf(UnauthorizedException);
    const inactive = make({ integ: { ...INTEG, active: false } });
    await expect(inactive.svc.ingest('tok', { title: 'x' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('abre chamado com cliente/categoria da integração e severity → prioridade', async () => {
    const { svc, tickets, prisma } = make();
    const r = await svc.ingest('tok', { title: 'SRV01 caiu', severity: 'urgent', externalId: 'z-1' });
    expect(r).toEqual({ ticketId: 't9', number: '000009', created: true });
    expect(tickets.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'c1',
        categoryId: 'cat1',
        priority: 'URGENT',
        origin: 'INTEGRATION',
        integrationId: 'i1',
        externalId: 'z-1',
        assetIds: [],
        locationId: null,
      }),
    );
    expect(tickets.create.mock.calls[0][0].description).toContain('Zabbix');
    expect(prisma.integration.update).toHaveBeenCalled();
  });

  it('sem severity → MEDIUM; sem externalId não procura duplicado', async () => {
    const { svc, tickets, prisma } = make();
    await svc.ingest('tok', { title: 'x' });
    expect(tickets.create.mock.calls[0][0].priority).toBe('MEDIUM');
    expect(prisma.ticket.findFirst).not.toHaveBeenCalled();
  });

  it('dedup: chamado aberto com mesmo externalId → só registra evento', async () => {
    const { svc, tickets, events, prisma } = make({ open: { id: 't1', number: '000001' } });
    const r = await svc.ingest('tok', { title: 'de novo', externalId: 'z-1' });
    expect(r).toEqual({ ticketId: 't1', number: '000001', created: false });
    expect(tickets.create).not.toHaveBeenCalled();
    expect(events.record).toHaveBeenCalledWith(prisma, 't1', 'INTEGRATION_EVENT', expect.objectContaining({ title: 'de novo' }));
    const where = prisma.ticket.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ integrationId: 'i1', externalId: 'z-1' });
    expect(where.status.notIn).toEqual(['RESOLVED', 'CLOSED', 'CANCELLED']);
  });

  it('assetSerial do cliente vincula ativo e local; busca restrita ao cliente', async () => {
    const { svc, tickets, prisma } = make({ asset: { id: 'a1', locationId: 'l1' } });
    await svc.ingest('tok', { title: 'x', assetSerial: 'SN1' });
    expect(prisma.asset.findFirst.mock.calls[0][0].where).toEqual({ clientId: 'c1', serialNumber: 'SN1' });
    expect(tickets.create.mock.calls[0][0]).toMatchObject({ assetIds: ['a1'], locationId: 'l1' });
  });
});

describe('IntegrationsService.ingest — construtor de eventos', () => {
  const UNIFI = {
    alarm: {
      name: 'Device Update Status',
      triggers: [{ key: 'update', device: 'SN-CAM-1', eventId: 'ev1' }],
      thumbnail: 'data:image/jpeg;base64,' + 'A'.repeat(5000),
    },
  };
  const MAPPING = {
    title: 'UniFi: {{alarm.name}}',
    description: 'Gatilho {{alarm.triggers.0.key}}',
    externalId: '{{alarm.name}}',
    assetSerial: '{{alarm.triggers.0.device}}',
    priority: 'HIGH',
  };

  it('sem mapeamento e sem title → captura (sem chamado) e guarda o exemplo cortado', async () => {
    const { svc, tickets, prisma } = make();
    const r = await svc.ingest('tok', UNIFI);
    expect(r).toEqual({ captured: true });
    expect(tickets.create).not.toHaveBeenCalled();
    const data = prisma.integration.update.mock.calls[0][0].data;
    expect(data.lastPayload.alarm.name).toBe('Device Update Status');
    expect(data.lastPayload.alarm.thumbnail.length).toBeLessThan(600);
    expect(data.lastPayloadAt).toBeInstanceOf(Date);
  });

  it('com mapeamento → abre chamado com os campos renderizados', async () => {
    const { svc, tickets, prisma } = make({
      integ: { ...INTEG, mapping: MAPPING },
      asset: { id: 'a1', locationId: 'l1' },
    });
    const r = await svc.ingest('tok', UNIFI);
    expect(r).toEqual({ ticketId: 't9', number: '000009', created: true });
    expect(tickets.create.mock.calls[0][0]).toMatchObject({
      title: 'UniFi: Device Update Status',
      description: 'Gatilho update',
      priority: 'HIGH',
      externalId: 'Device Update Status',
      assetIds: ['a1'],
      locationId: 'l1',
    });
    expect(prisma.asset.findFirst.mock.calls[0][0].where).toEqual({ clientId: 'c1', serialNumber: 'SN-CAM-1' });
  });

  it('mapeamento tem prioridade sobre o formato padrão; dedup por externalId renderizado', async () => {
    const { svc, tickets, events } = make({
      integ: { ...INTEG, mapping: MAPPING },
      open: { id: 't1', number: '000001' },
    });
    const r = await svc.ingest('tok', { ...UNIFI, title: 'ignorado' });
    expect(r).toEqual({ ticketId: 't1', number: '000001', created: false });
    expect(tickets.create).not.toHaveBeenCalled();
    expect(events.record.mock.calls[0][3]).toMatchObject({ title: 'UniFi: Device Update Status' });
  });

  it('mapeamento que gera título vazio → 422', async () => {
    const { svc } = make({ integ: { ...INTEG, mapping: { title: '{{nao.existe}}' } } });
    await expect(svc.ingest('tok', UNIFI)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('formato padrão inválido → 400; corpo não-objeto → captura', async () => {
    const { svc } = make();
    await expect(svc.ingest('tok', { title: 'x', severity: 'pânico' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.ingest('tok', [1, 2])).resolves.toEqual({ captured: true });
    await expect(svc.ingest('tok', undefined)).resolves.toEqual({ captured: true });
  });
});

describe('regra de status (abre na desconexão, encerra na conexão)', () => {
  const MAP = {
    title: 'Facial {{device}} offline',
    externalId: '{{device}}',
    status: '{{event}}',
    problemValues: ['disconnected'],
    okValues: ['Connected'],
  };
  const ev = (event: string) => ({ device: 'FAC-01', event });

  it('classifyStatus: compara sem caixa/espaços; problema vazio = qualquer outro; vazio → ignora', () => {
    expect(classifyStatus(MAP as any, ev(' CONNECTED '))?.kind).toBe('ok');
    expect(classifyStatus(MAP as any, ev('Disconnected'))?.kind).toBe('problem');
    expect(classifyStatus(MAP as any, ev('rebooting'))?.kind).toBe('ignore');
    expect(classifyStatus({ ...MAP, problemValues: [] } as any, ev('rebooting'))?.kind).toBe('problem');
    expect(classifyStatus({ ...MAP, problemValues: [] } as any, {})?.kind).toBe('ignore');
    expect(classifyStatus({ title: 'x' } as any, ev('x'))).toBeNull();
  });

  it('desconexão abre chamado', async () => {
    const { svc, tickets } = make({ integ: { ...INTEG, mapping: MAP } });
    const r = await svc.ingest('tok', ev('disconnected'));
    expect(r).toMatchObject({ created: true });
    expect(tickets.create.mock.calls[0][0]).toMatchObject({ title: 'Facial FAC-01 offline', externalId: 'FAC-01' });
  });

  it('conexão com chamado aberto → registra evento e resolve (padrão) sem abrir chamado', async () => {
    const { svc, tickets, events, prisma } = make({
      integ: { ...INTEG, mapping: MAP },
      open: { id: 't1', number: '000001' },
    });
    const r = await svc.ingest('tok', ev('connected'));
    expect(r).toEqual({ ticketId: 't1', number: '000001', resolved: true });
    expect(tickets.create).not.toHaveBeenCalled();
    expect(tickets.changeStatus).toHaveBeenCalledWith('t1', 'RESOLVED');
    expect(events.record.mock.calls[0][2]).toBe('INTEGRATION_EVENT');
    expect(prisma.ticket.findFirst.mock.calls[0][0].where).toMatchObject({ integrationId: 'i1', externalId: 'FAC-01' });
  });

  it('okAction CLOSED fecha', async () => {
    const { svc, tickets } = make({
      integ: { ...INTEG, mapping: { ...MAP, okAction: 'CLOSED' } },
      open: { id: 't1', number: '000001' },
    });
    await svc.ingest('tok', ev('connected'));
    expect(tickets.changeStatus).toHaveBeenCalledWith('t1', 'CLOSED');
  });

  it('conexão sem chamado aberto ou status desconhecido → ignora, nunca abre', async () => {
    const a = make({ integ: { ...INTEG, mapping: MAP } });
    expect(await a.svc.ingest('tok', ev('connected'))).toMatchObject({ ignored: true });
    expect(await a.svc.ingest('tok', ev('rebooting'))).toMatchObject({ ignored: true });
    expect(a.tickets.create).not.toHaveBeenCalled();
    expect(a.tickets.changeStatus).not.toHaveBeenCalled();
  });

  it('guarda os últimos 10 eventos, mais recente primeiro', async () => {
    const old = Array.from({ length: 10 }, (_, i) => ({ at: `t${i}`, payload: { i } }));
    const { svc, prisma } = make({ integ: { ...INTEG, recentPayloads: old } });
    await svc.ingest('tok', { novo: true });
    const recent = prisma.integration.update.mock.calls[0][0].data.recentPayloads;
    expect(recent).toHaveLength(10);
    expect(recent[0].payload).toEqual({ novo: true });
    expect(recent[9].payload).toEqual({ i: 8 });
  });
});
