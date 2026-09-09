import { describe, expect, it, vi } from 'vitest';
import { BackupCron } from './backup.cron.js';

function make(enabled: boolean, existing: string[] = [], retention?: number) {
  const settings = {
    getBool: vi.fn(async () => enabled),
    getNumber: vi.fn(async () => retention),
  };
  const backup = { export: vi.fn(async () => ({ meta: { version: 1 }, data: {} })) };
  const storage = {
    put: vi.fn(async (_k: string, _b: Buffer, _m: string) => undefined),
    list: vi.fn(async () => existing),
    remove: vi.fn(async (_k: string) => undefined),
  };
  const cron = new BackupCron(settings as any, backup as any, storage as any);
  vi.spyOn((cron as any).logger, 'log').mockImplementation(() => {});
  vi.spyOn((cron as any).logger, 'error').mockImplementation(() => {});
  return { cron, settings, backup, storage };
}

describe('BackupCron', () => {
  it('desligado: não exporta nem grava', async () => {
    const { cron, backup, storage } = make(false);
    await cron.run();
    expect(backup.export).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('ligado: exporta e grava um backups/os-backup-*.json', async () => {
    const { cron, storage } = make(true);
    await cron.run();
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(storage.put.mock.calls[0][0]).toMatch(/^backups\/os-backup-.*\.json$/);
  });

  it('poda mantém os N mais recentes (retention=2)', async () => {
    const existing = [
      'backups/os-backup-2026-09-01.json',
      'backups/os-backup-2026-09-02.json',
      'backups/os-backup-2026-09-03.json',
      'backups/os-backup-2026-09-04.json',
    ];
    const { cron, storage } = make(true, existing, 2);
    await cron.run();
    expect(storage.remove).toHaveBeenCalled();
    const removed = storage.remove.mock.calls.map((c) => c[0]);
    expect(removed).toContain('backups/os-backup-2026-09-01.json');
    expect(removed).not.toContain('backups/os-backup-2026-09-04.json');
  });
});
