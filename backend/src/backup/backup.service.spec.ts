import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { BACKUP_VERSION, BackupService, TABLE_ORDER } from './backup.service.js';

function makePrisma() {
  const p: any = { $transaction: vi.fn(async (fn: any) => fn(p)) };
  for (const t of TABLE_ORDER) {
    p[t] = {
      findMany: vi.fn(async () => [{ id: `${t}-1` }]),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      createMany: vi.fn(async () => ({ count: 1 })),
    };
  }
  return p;
}

describe('BackupService.export', () => {
  it('inclui todas as tabelas do TABLE_ORDER e não inclui refreshToken', async () => {
    const prisma = makePrisma();
    const file = await new BackupService(prisma as any).export();
    expect(file.meta.version).toBe(BACKUP_VERSION);
    for (const t of TABLE_ORDER) expect(file.data[t]).toHaveLength(1);
    expect(file.data.refreshToken).toBeUndefined();
  });
});

describe('BackupService.import', () => {
  it('rejeita versão errada antes de qualquer deleteMany', async () => {
    const prisma = makePrisma();
    const svc = new BackupService(prisma as any);
    await expect(svc.import({ meta: { version: 99 }, data: {} } as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.user.deleteMany).not.toHaveBeenCalled();
  });

  it('rejeita payload sem data', async () => {
    const svc = new BackupService(makePrisma() as any);
    await expect(svc.import({ meta: { version: BACKUP_VERSION } } as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('apaga em ordem reversa e recria em ordem direta', async () => {
    const prisma = makePrisma();
    const svc = new BackupService(prisma as any);
    const data = Object.fromEntries(TABLE_ORDER.map((t) => [t, [{ id: `${t}-1` }]]));
    await svc.import({ meta: { version: BACKUP_VERSION }, data } as any);
    const firstDeleted = TABLE_ORDER.at(-1)!;
    expect(prisma[firstDeleted].deleteMany).toHaveBeenCalled();
    expect(prisma[TABLE_ORDER[0]].createMany).toHaveBeenCalledWith({
      data: [{ id: `${TABLE_ORDER[0]}-1` }],
      skipDuplicates: false,
    });
  });
});
