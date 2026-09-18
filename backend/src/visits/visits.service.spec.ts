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

describe('VisitsService.checkIn / checkOut / setLabor', () => {
  it('checkIn: exige status SCHEDULED, grava horário/GPS e vira IN_PROGRESS', async () => {
    const { service, prisma, events } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'SCHEDULED', ticketId: 't1' }) },
    });
    await service.checkIn('v1', { lat: -23.5, lng: -46.6 });
    expect(prisma.visit.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: expect.objectContaining({
        status: 'IN_PROGRESS',
        checkInLat: -23.5,
        checkInLng: -46.6,
      }),
    });
    expect(events.record).toHaveBeenCalledWith(prisma, 't1', 'VISIT_STARTED', { visitId: 'v1' });
  });

  it('checkIn: chamado OPEN vira IN_PROGRESS e registra STATUS_CHANGED', async () => {
    const { service, prisma } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'SCHEDULED', ticketId: 't1' }) },
      ticket: {
        findUnique: vi.fn().mockResolvedValue({ id: 't1', status: 'OPEN' }),
        update: vi.fn(),
      },
    });
    await service.checkIn('v1', {});
    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: 'IN_PROGRESS' },
    });
  });

  it('checkIn: rejeita visita que não está SCHEDULED', async () => {
    const { service } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'DONE', ticketId: 't1' }) },
    });
    await expect(service.checkIn('v1', {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('checkOut: exige status IN_PROGRESS, grava horário/GPS', async () => {
    const { service, prisma } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'IN_PROGRESS', ticketId: 't1' }) },
    });
    await service.checkOut('v1', { lat: 1, lng: 2 });
    expect(prisma.visit.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: expect.objectContaining({ checkOutLat: 1, checkOutLng: 2 }),
    });
  });

  it('checkOut: rejeita visita que não está IN_PROGRESS', async () => {
    const { service } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'SCHEDULED', ticketId: 't1' }) },
    });
    await expect(service.checkOut('v1', {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('setLabor: rejeita fim antes do início', async () => {
    const { service } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'IN_PROGRESS', ticketId: 't1' }) },
    });
    await expect(
      service.setLabor('v1', { laborStartAt: '2026-10-01T12:00:00.000Z', laborEndAt: '2026-10-01T11:00:00.000Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('setLabor: aceita correção manual em qualquer status', async () => {
    const { service, prisma } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'DONE', ticketId: 't1' }) },
    });
    await service.setLabor('v1', { laborStartAt: '2026-10-01T11:00:00.000Z', laborEndAt: '2026-10-01T12:00:00.000Z' });
    expect(prisma.visit.update).toHaveBeenCalled();
  });
});

describe('VisitsService.setChecklist', () => {
  it('rejeita item que não pertence ao template da visita', async () => {
    const { service } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'IN_PROGRESS', ticketId: 't1', checklistTemplateId: 'tmpl1' }) },
      checklistTemplateItem: { findMany: vi.fn().mockResolvedValue([{ id: 'item1' }]) },
    });
    await expect(
      service.setChecklist('v1', { answers: [{ itemId: 'item-invalido', done: true }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita quando a visita não tem template associado', async () => {
    const { service } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'IN_PROGRESS', ticketId: 't1', checklistTemplateId: null }) },
    });
    await expect(service.setChecklist('v1', { answers: [] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('faz upsert de cada resposta válida', async () => {
    const { service, prisma } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'IN_PROGRESS', ticketId: 't1', checklistTemplateId: 'tmpl1' }) },
      checklistTemplateItem: { findMany: vi.fn().mockResolvedValue([{ id: 'item1' }, { id: 'item2' }]) },
    });
    await service.setChecklist('v1', {
      answers: [
        { itemId: 'item1', done: true },
        { itemId: 'item2', done: false, note: 'sem acesso' },
      ],
    });
    expect(prisma.visitChecklistAnswer.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.visitChecklistAnswer.upsert).toHaveBeenCalledWith({
      where: { visitId_itemId: { visitId: 'v1', itemId: 'item1' } },
      create: { visitId: 'v1', itemId: 'item1', done: true, note: null },
      update: { done: true, note: null },
    });
  });
});

describe('VisitsService.close', () => {
  function readyVisit(over: Record<string, unknown> = {}) {
    return {
      id: 'v1',
      status: 'IN_PROGRESS',
      ticketId: 't1',
      checkOutAt: new Date(),
      checklistTemplateId: 'tmpl1',
      ...over,
    };
  }

  it('recusa sem checkout, checklist incompleto ou sem assinatura', async () => {
    const { service } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue(readyVisit({ checkOutAt: null })) },
      checklistTemplateItem: { findMany: vi.fn().mockResolvedValue([{ id: 'i1' }]) },
      visitChecklistAnswer: { count: vi.fn().mockResolvedValue(0) },
      attachment: { count: vi.fn().mockResolvedValue(0) },
    });
    await expect(service.close('v1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fecha quando tudo presente: status DONE, evento e laudo enviado', async () => {
    const { service, prisma, events, report } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue(readyVisit()) },
      checklistTemplateItem: { findMany: vi.fn().mockResolvedValue([{ id: 'i1' }]) },
      visitChecklistAnswer: { count: vi.fn().mockResolvedValue(1) },
      attachment: { count: vi.fn().mockResolvedValue(1) },
    });
    await service.close('v1');
    expect(prisma.visit.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { status: 'DONE' } });
    expect(events.record).toHaveBeenCalledWith(prisma, 't1', 'VISIT_COMPLETED', { visitId: 'v1' });
    expect(report.generate).toHaveBeenCalledWith('v1');
    expect(report.sendEmail).toHaveBeenCalled();
  });

  it('fecha mesmo se o laudo falhar ao gerar/enviar (não propaga)', async () => {
    const { service, prisma, report } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue(readyVisit()) },
      checklistTemplateItem: { findMany: vi.fn().mockResolvedValue([{ id: 'i1' }]) },
      visitChecklistAnswer: { count: vi.fn().mockResolvedValue(1) },
      attachment: { count: vi.fn().mockResolvedValue(1) },
    });
    report.generate.mockRejectedValue(new Error('storage fora'));
    await expect(service.close('v1')).resolves.toBeDefined();
    expect(prisma.visit.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { status: 'DONE' } });
  });

  it('recusa fechar visita que não está IN_PROGRESS', async () => {
    const { service } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue(readyVisit({ status: 'SCHEDULED' })) },
    });
    await expect(service.close('v1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('VisitsService.resendReport', () => {
  it('reaproveita o Attachment REPORT existente e reenvia', async () => {
    const { service, prisma, report } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', ticketId: 't1' }) },
      attachment: {
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn().mockResolvedValue({ id: 'rep1', kind: 'REPORT' }),
      },
    });
    await service.resendReport('v1');
    expect(report.generate).not.toHaveBeenCalled();
    expect(report.sendEmail).toHaveBeenCalledWith('v1', { id: 'rep1', kind: 'REPORT' });
    expect(prisma.visit.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { reportSentAt: expect.any(Date) },
    });
  });

  it('gera o laudo se ainda não existir', async () => {
    const { service, report } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', ticketId: 't1' }) },
      attachment: { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn().mockResolvedValue(null) },
    });
    report.generate.mockResolvedValue({ id: 'rep2', kind: 'REPORT' });
    await service.resendReport('v1');
    expect(report.generate).toHaveBeenCalledWith('v1');
    expect(report.sendEmail).toHaveBeenCalledWith('v1', { id: 'rep2', kind: 'REPORT' });
  });
});
