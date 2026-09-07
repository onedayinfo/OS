import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AttachmentsService } from './attachments.service.js';
import { safeExt, storedName } from './storage.util.js';

const png = (over: Partial<any> = {}) => ({
  originalname: 'foto.png',
  mimetype: 'image/png',
  size: 1234,
  buffer: Buffer.from('conteudo'),
  ...over,
});

function makeDeps() {
  const prisma = {
    attachment: {
      create: vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'at1', createdAt: new Date(), ...data }),
      ),
      findUnique: vi.fn(),
    },
    ticketComment: { findUnique: vi.fn() },
  };
  const tickets = { assertAccess: vi.fn().mockResolvedValue({ id: 't1' }) };
  const service = new AttachmentsService(prisma as any, tickets as any);
  return { service, prisma, tickets };
}

const actor = { id: 'u1', type: 'INTERNAL', role: 'AGENT', clientId: null };

describe('storage.util', () => {
  it('safeExt aceita só `.\\w+`', () => {
    expect(safeExt('a.png')).toBe('.png');
    expect(safeExt('a.tar.gz')).toBe('.gz');
    expect(safeExt('semext')).toBe('');
    expect(safeExt('x.")]}')).toBe('');
  });

  it('storedName gera `<uuid>.png` sem herdar o nome original', () => {
    const name = storedName('../../etc/passwd.png');
    expect(name).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(name).not.toContain('passwd');
  });
});

describe('AttachmentsService.saveForTicket', () => {
  it('rejeita mime fora da allowlist → BadRequestException', async () => {
    const { service } = makeDeps();
    await expect(
      service.saveForTicket('t1', png({ mimetype: 'application/x-msdownload' }), actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita arquivo > 10 MB → BadRequestException', async () => {
    const { service } = makeDeps();
    await expect(
      service.saveForTicket('t1', png({ size: 11 * 1024 * 1024 }), actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('grava caminho previsível dentro de STORAGE_PATH e Attachment só com ticketId', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'att-'));
    const prev = process.env.STORAGE_PATH;
    process.env.STORAGE_PATH = dir;
    try {
      const { service } = makeDeps();
      const out = await service.saveForTicket('t1', png(), actor);

      expect(out.ticketId).toBe('t1');
      expect(out.commentId).toBeUndefined();
      expect(out.storedPath.startsWith(dir)).toBe(true);
      expect(out.storedPath).toMatch(/[0-9a-f-]{36}\.png$/);
      expect(readFileSync(out.storedPath).toString()).toBe('conteudo');
    } finally {
      process.env.STORAGE_PATH = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('actor nulo pula a guarda de acesso', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'att-'));
    const prev = process.env.STORAGE_PATH;
    process.env.STORAGE_PATH = dir;
    try {
      const { service, tickets } = makeDeps();
      await service.saveForTicket('t1', png(), undefined);
      expect(tickets.assertAccess).not.toHaveBeenCalled();
    } finally {
      process.env.STORAGE_PATH = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('AttachmentsService.getForDownload', () => {
  it('anexo de ticket de outro cliente (assertAccess lança) → NotFoundException', async () => {
    const { service, prisma, tickets } = makeDeps();
    prisma.attachment.findUnique.mockResolvedValue({ id: 'at1', ticketId: 't9', commentId: null });
    tickets.assertAccess.mockRejectedValue(new NotFoundException());
    await expect(service.getForDownload('at1', actor)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('anexo inexistente → NotFoundException', async () => {
    const { service, prisma } = makeDeps();
    prisma.attachment.findUnique.mockResolvedValue(null);
    await expect(service.getForDownload('x', actor)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('anexo de comentário resolve o ticket dono e valida acesso', async () => {
    const { service, prisma, tickets } = makeDeps();
    prisma.attachment.findUnique.mockResolvedValue({ id: 'at1', ticketId: null, commentId: 'c1' });
    prisma.ticketComment.findUnique.mockResolvedValue({ ticketId: 't1' });
    const out = await service.getForDownload('at1', actor);
    expect(tickets.assertAccess).toHaveBeenCalledWith('t1', actor);
    expect(out.id).toBe('at1');
  });
});
