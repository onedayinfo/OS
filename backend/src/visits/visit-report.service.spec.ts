import { VisitReportService } from './visit-report.service.js';

const baseVisit = {
  id: 'v1',
  ticketId: 't1',
  technicianId: 'tech1',
  scheduledStart: new Date('2026-10-01T13:00:00.000Z'),
  scheduledEnd: new Date('2026-10-01T14:00:00.000Z'),
  checkInAt: new Date('2026-10-01T13:05:00.000Z'),
  checkOutAt: new Date('2026-10-01T13:50:00.000Z'),
  laborStartAt: new Date('2026-10-01T13:05:00.000Z'),
  laborEndAt: new Date('2026-10-01T13:50:00.000Z'),
  notes: null,
  ticket: { id: 't1', number: '2026-0001', title: 'Sem imagem', client: { name: 'Cliente X' }, location: null },
  technician: { name: 'Fulano' },
  checklistTemplate: { items: [{ id: 'i1', label: 'Energia ok' }] },
  checklistAnswers: [{ itemId: 'i1', done: true, note: null }],
};

function makeDeps(overrides: Record<string, unknown> = {}) {
  const prisma = {
    visit: { findUnique: vi.fn().mockResolvedValue(baseVisit) },
    attachment: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'rep1', ...data })),
    },
    user: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
    ...overrides,
  };
  const storage = { put: vi.fn().mockResolvedValue(undefined), readable: vi.fn() };
  const email = {
    send: vi.fn().mockResolvedValue(undefined),
    brand: vi.fn().mockResolvedValue({ companyName: 'OneDay' }),
  };
  const service = new VisitReportService(prisma as any, storage as any, email as any);
  return { service, prisma, storage, email };
}

describe('VisitReportService.generate', () => {
  it('gera o PDF, grava no storage e cria o Attachment com ticketId + visitId + kind REPORT', async () => {
    const { service, storage, prisma } = makeDeps();
    const attachment = await service.generate('v1');
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringContaining('visit-reports/'),
      expect.any(Buffer),
      'application/pdf',
    );
    expect(prisma.attachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ticketId: 't1', visitId: 'v1', kind: 'REPORT', mime: 'application/pdf' }),
      }),
    );
    expect(attachment.kind).toBe('REPORT');
  });
});

describe('VisitReportService.sendEmail', () => {
  it('envia pro solicitante e pros MANAGER do cliente, com link do chamado', async () => {
    const { service, prisma, email } = makeDeps({
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'req1', email: 'solicitante@x.test' }),
        findMany: vi.fn().mockResolvedValue([{ id: 'mgr1', email: 'gestor@x.test' }]),
      },
    });
    prisma.visit.findUnique.mockResolvedValue({
      ...baseVisit,
      ticket: { ...baseVisit.ticket, clientId: 'cli1', requesterId: 'req1' },
    });
    await service.sendEmail('v1', { id: 'rep1' } as any);
    expect(email.send).toHaveBeenCalledTimes(2);
    const [args] = email.send.mock.calls[0];
    expect(args.html).toContain('/portal/chamados/t1');
  });
});
