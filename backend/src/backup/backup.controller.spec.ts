import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BackupController } from './backup.controller.js';

const backup = {
  export: vi.fn(async () => ({ meta: { version: 1 }, data: {} })),
  import: vi.fn(),
};
const storage = { list: vi.fn(async () => ['backups/os-backup-2026-09-01.json']) };
const actor = { id: 'u1' } as any;
const groups = { isFullAdmin: vi.fn(async () => true) };

describe('BackupController', () => {
  it('não-admin-pleno recebe 403 em export, import e list', async () => {
    groups.isFullAdmin.mockResolvedValue(false);
    const c = new BackupController(backup as any, storage as any, groups as any);
    await expect(c.export({} as any, actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.import({} as any, { confirm: 'RESTAURAR' }, actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.list(actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(backup.import).not.toHaveBeenCalled();
    groups.isFullAdmin.mockResolvedValue(true);
  });

  it('export escreve JSON com header de download', async () => {
    const c = new BackupController(backup as any, storage as any, groups as any);
    const res: any = { setHeader: vi.fn(), send: vi.fn() };
    await c.export(res, actor);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('attachment; filename="os-backup-'),
    );
    expect(res.send).toHaveBeenCalled();
  });

  it('import sem confirm="RESTAURAR" recusa', async () => {
    const c = new BackupController(backup as any, storage as any, groups as any);
    await expect(
      c.import({ buffer: Buffer.from('{}') } as any, { confirm: 'x' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(backup.import).not.toHaveBeenCalled();
  });

  it('import com JSON inválido recusa', async () => {
    const c = new BackupController(backup as any, storage as any, groups as any);
    await expect(
      c.import({ buffer: Buffer.from('nao-json') } as any, { confirm: 'RESTAURAR' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('import feliz chama backup.import', async () => {
    const c = new BackupController(backup as any, storage as any, groups as any);
    await c.import(
      { buffer: Buffer.from('{"meta":{"version":1},"data":{}}') } as any,
      { confirm: 'RESTAURAR' },
      actor,
    );
    expect(backup.import).toHaveBeenCalled();
  });

  it('list devolve nomes ordenados desc', async () => {
    storage.list.mockResolvedValueOnce([
      'backups/os-backup-2026-09-01.json',
      'backups/os-backup-2026-09-03.json',
    ]);
    const c = new BackupController(backup as any, storage as any, groups as any);
    expect(await c.list(actor)).toEqual([
      { name: 'backups/os-backup-2026-09-03.json' },
      { name: 'backups/os-backup-2026-09-01.json' },
    ]);
  });
});
