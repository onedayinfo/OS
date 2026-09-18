import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { VisitsService } from './visits.service.js';

function makeDeps(overrides: Record<string, unknown> = {}) {
  const { visit: visitOverride, ...rest } = overrides as { visit?: Record<string, unknown> };
  const prisma = {
    ticket: {
      findUnique: vi.fn().mockResolvedValue({ id: 't1', categoryId: null, status: 'OPEN' }),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: 'tech1', type: 'INTERNAL', role: 'AGENT', active: true }),
    },
    visit: {
      create: vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'v1', status: 'SCHEDULED', ...data }),
      ),
      findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'SCHEDULED', ticketId: 't1', checklistTemplateId: 'tmpl1' }),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'v1', ...data })),
      findMany: vi.fn().mockResolvedValue([]),
      ...visitOverride,
    },
    checklistTemplateItem: { findMany: vi.fn().mockResolvedValue([]) },
    visitChecklistAnswer: { count: vi.fn().mockResolvedValue(0), upsert: vi.fn() },
    attachment: { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn() },
    ...rest,
  };
  const events = { record: vi.fn() };
  const templates = { resolveForCategory: vi.fn().mockResolvedValue({ id: 'tmpl1' }) };
  const report = { generate: vi.fn(), sendEmail: vi.fn() };
  const service = new VisitsService(prisma as any, events as any, templates as any, report as any);
  return { service, prisma, events, templates, report };
}

describe('VisitsService.create', () => {
  it('cria a visita e resolve o template pela categoria do chamado', async () => {
    const { service, prisma, events, templates } = makeDeps();
    await service.create({
      ticketId: 't1',
      technicianId: 'tech1',
      scheduledStart: '2026-10-01T13:00:00.000Z',
      scheduledEnd: '2026-10-01T14:00:00.000Z',
    });
    expect(templates.resolveForCategory).toHaveBeenCalledWith(null);
    expect(prisma.visit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ticketId: 't1', technicianId: 'tech1', checklistTemplateId: 'tmpl1' }),
      }),
    );
    expect(events.record).toHaveBeenCalledWith(prisma, 't1', 'VISIT_SCHEDULED', expect.any(Object));
  });

  it('rejeita chamado inexistente', async () => {
    const { service, prisma } = makeDeps({ ticket: { findUnique: vi.fn().mockResolvedValue(null) } });
    await expect(
      service.create({ ticketId: 'nope', technicianId: 'tech1', scheduledStart: '2026-10-01T13:00:00.000Z', scheduledEnd: '2026-10-01T14:00:00.000Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.visit.create).not.toHaveBeenCalled();
  });

  it('rejeita técnico que não é AGENT ativo', async () => {
    const { service } = makeDeps({
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'u2', type: 'INTERNAL', role: 'ADMIN', active: true }) },
    });
    await expect(
      service.create({ ticketId: 't1', technicianId: 'u2', scheduledStart: '2026-10-01T13:00:00.000Z', scheduledEnd: '2026-10-01T14:00:00.000Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita janela invertida (fim antes do início)', async () => {
    const { service } = makeDeps();
    await expect(
      service.create({ ticketId: 't1', technicianId: 'tech1', scheduledStart: '2026-10-01T14:00:00.000Z', scheduledEnd: '2026-10-01T13:00:00.000Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('VisitsService.reschedule / cancel', () => {
  it('reschedule: só permitido com status SCHEDULED', async () => {
    const { service, prisma } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'IN_PROGRESS', ticketId: 't1', scheduledStart: new Date(), scheduledEnd: new Date() }) },
    });
    await expect(service.reschedule('v1', { scheduledStart: '2026-10-02T10:00:00.000Z' })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.visit.update).not.toHaveBeenCalled();
  });

  it('cancel: rejeita visita já DONE', async () => {
    const { service } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'DONE', ticketId: 't1' }) },
    });
    await expect(service.cancel('v1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('cancel: 404 se a visita não existe', async () => {
    const { service } = makeDeps({ visit: { findUnique: vi.fn().mockResolvedValue(null) } });
    await expect(service.cancel('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
