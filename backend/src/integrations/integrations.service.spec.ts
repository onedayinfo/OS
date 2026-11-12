import { UnauthorizedException } from '@nestjs/common';
import { IntegrationsService, extractToken } from './integrations.service.js';
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
  const tickets = { create: vi.fn().mockResolvedValue({ id: 't9', number: '000009' }) };
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
