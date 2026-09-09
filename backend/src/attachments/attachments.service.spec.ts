import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AttachmentsService } from './attachments.service.js';
import { StorageService } from '../storage/storage.service.js';
import { safeExt, storedName } from './storage.util.js';

const diskStorage = () =>
  new StorageService({
    get: async (k: string) => (k === 'storage.driver' ? 'disk' : undefined),
  } as never);

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
  const service = new AttachmentsService(prisma as any, tickets as any, diskStorage());
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

  it('grava caminho previsível dentro de STORAGE_PATH; retorno é allowlist (sem storedPath/uploadedById)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'att-'));
    const prev = process.env.STORAGE_PATH;
    process.env.STORAGE_PATH = dir;
    try {
      const { service, prisma } = makeDeps();
      const out = await service.saveForTicket('t1', png(), actor);

      // O caminho no FS é verificado pelo argumento passado ao prisma.create,
      // não pelo retorno da rota (que não expõe storedPath).
      const persisted = prisma.attachment.create.mock.calls[0][0].data;
      expect(persisted.ticketId).toBe('t1');
      // storedPath agora é uma key relativa; o arquivo vive em STORAGE_PATH/<key>.
      expect(persisted.storedPath).toMatch(/^attachments\/[0-9a-f-]{36}\.png$/);
      expect(readFileSync(join(dir, persisted.storedPath)).toString()).toBe('conteudo');

      expect(out).not.toHaveProperty('storedPath');
      expect(out).not.toHaveProperty('uploadedById');
      expect(out).toMatchObject({
        id: expect.any(String),
        filename: 'foto.png',
        mime: 'image/png',
        size: 1234,
        createdAt: expect.any(Date),
        ticketId: 't1',
      });
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

  const clientActor = { id: 'c1', type: 'CLIENT', role: 'CLIENT', clientId: 'cli1' };

  it('anexo de comentário INTERNAL + actor CLIENT (mesmo com acesso ao ticket) → NotFoundException', async () => {
    const { service, prisma, tickets } = makeDeps();
    prisma.attachment.findUnique.mockResolvedValue({ id: 'at1', ticketId: null, commentId: 'c1' });
    prisma.ticketComment.findUnique.mockResolvedValue({ ticketId: 't1', visibility: 'INTERNAL' });
    await expect(service.getForDownload('at1', clientActor)).rejects.toBeInstanceOf(NotFoundException);
    expect(tickets.assertAccess).not.toHaveBeenCalled();
  });

  it('anexo de comentário INTERNAL + actor AGENT → OK', async () => {
    const { service, prisma } = makeDeps();
    prisma.attachment.findUnique.mockResolvedValue({ id: 'at1', ticketId: null, commentId: 'c1' });
    prisma.ticketComment.findUnique.mockResolvedValue({ ticketId: 't1', visibility: 'INTERNAL' });
    const out = await service.getForDownload('at1', actor);
    expect(out.id).toBe('at1');
  });

  it('anexo de comentário PUBLIC + actor CLIENT → OK', async () => {
    const { service, prisma, tickets } = makeDeps();
    prisma.attachment.findUnique.mockResolvedValue({ id: 'at1', ticketId: null, commentId: 'c1' });
    prisma.ticketComment.findUnique.mockResolvedValue({ ticketId: 't1', visibility: 'PUBLIC' });
    const out = await service.getForDownload('at1', clientActor);
    expect(tickets.assertAccess).toHaveBeenCalledWith('t1', clientActor);
    expect(out.id).toBe('at1');
  });

  it('anexo de nível ticket + actor CLIENT → inalterado (só assertAccess decide)', async () => {
    const { service, prisma, tickets } = makeDeps();
    prisma.attachment.findUnique.mockResolvedValue({ id: 'at1', ticketId: 't1', commentId: null });
    const out = await service.getForDownload('at1', clientActor);
    expect(tickets.assertAccess).toHaveBeenCalledWith('t1', clientActor);
    expect(out.id).toBe('at1');
  });
});
