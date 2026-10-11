import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { BACKUP_VERSION, BackupService, DEFERRED_FK, TABLE_ORDER, TABLE_ORDER_V1 } from './backup.service.js';

function makePrisma() {
  const p: any = { $transaction: vi.fn(async (fn: any) => fn(p)) };
  for (const t of TABLE_ORDER) {
    p[t] = {
      update: vi.fn(async () => ({})),
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

  it('backup v1 só restaura e apaga as tabelas do formato antigo', async () => {
    const prisma = makePrisma();
    const data = Object.fromEntries(TABLE_ORDER.map((t) => [t, [{ id: `${t}-1` }]]));
    await new BackupService(prisma as any).import({ meta: { version: 1 }, data } as any);
    for (const t of TABLE_ORDER) {
      const touched = (TABLE_ORDER_V1 as readonly string[]).includes(t);
      expect(prisma[t].deleteMany).toHaveBeenCalledTimes(touched ? 1 : 0);
      expect(prisma[t].createMany).toHaveBeenCalledTimes(touched ? 1 : 0);
    }
  });
});

describe('ordem de FK do TABLE_ORDER', () => {
  it('todo pai vem antes do filho (exceto a FK adiada e refreshToken)', () => {
    const idx = (n: string) => (TABLE_ORDER as readonly string[]).indexOf(n[0].toLowerCase() + n.slice(1));
    for (const m of Prisma.dmmf.datamodel.models) {
      if (idx(m.name) < 0) continue;
      for (const f of m.fields) {
        if (!f.relationFromFields?.length || DEFERRED_FK[m.name[0].toLowerCase() + m.name.slice(1)] === f.relationFromFields[0]) continue;
        expect(idx(f.type), `${m.name}.${f.name} -> ${f.type}`).toBeGreaterThanOrEqual(0);
        expect(idx(f.type), `${m.name}.${f.name} -> ${f.type}`).toBeLessThan(idx(m.name));
      }
    }
  });

  it('FK adiada é preenchida depois, com update por linha', async () => {
    const prisma = makePrisma();
    const data = { quote: [{ id: 'q1', ticketId: 't1' }, { id: 'q2', ticketId: null }] };
    await new BackupService(prisma as any).import({ meta: { version: BACKUP_VERSION }, data } as any);
    expect(prisma.quote.createMany.mock.calls[0][0].data.every((r: any) => r.ticketId === null)).toBe(true);
    expect(prisma.quote.update).toHaveBeenCalledTimes(1);
    expect(prisma.quote.update).toHaveBeenCalledWith({ where: { id: 'q1' }, data: { ticketId: 't1' } });
  });
});
