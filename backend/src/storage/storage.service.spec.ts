import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageService, isLegacyDiskPath } from './storage.service.js';

function settingsStub(overrides: Record<string, string> = {}) {
  const map: Record<string, string> = { 'storage.driver': 'disk', ...overrides };
  return { get: vi.fn(async (k: string) => map[k]), getBool: vi.fn(async () => false) };
}

async function drain(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

describe('isLegacyDiskPath', () => {
  it.each(['/var/uploads/x.png', 'C:\\uploads\\x.png', '\\\\srv\\share\\x'])('%s -> true', (p) => {
    expect(isLegacyDiskPath(p)).toBe(true);
  });
  it('key relativa -> false', () => {
    expect(isLegacyDiskPath('attachments/abc.png')).toBe(false);
  });
});

describe('StorageService (driver disk)', () => {
  let base: string;
  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'os-storage-'));
    process.env.STORAGE_PATH = base;
  });

  it('put grava e readable devolve os mesmos bytes', async () => {
    const svc = new StorageService(settingsStub() as any);
    await svc.put('attachments/a.txt', Buffer.from('ola'), 'text/plain');
    const obj = await svc.readable('attachments/a.txt');
    expect((await drain(obj.stream)).toString()).toBe('ola');
  });

  it('dual-read: caminho absoluto legado é lido direto do disco', async () => {
    const legacy = join(base, 'legado.txt');
    await writeFile(legacy, 'antigo');
    const svc = new StorageService(settingsStub({ 'storage.driver': 's3' }) as any);
    const obj = await svc.readable(legacy);
    expect((await drain(obj.stream)).toString()).toBe('antigo');
  });

  it('remove apaga o objeto', async () => {
    const svc = new StorageService(settingsStub() as any);
    await svc.put('attachments/b.txt', Buffer.from('x'), 'text/plain');
    await svc.remove('attachments/b.txt');
    expect(await svc.exists('attachments/b.txt')).toBe(false);
  });

  it('list devolve as keys sob o prefixo', async () => {
    const svc = new StorageService(settingsStub() as any);
    await svc.put('backups/1.json', Buffer.from('{}'), 'application/json');
    await svc.put('backups/2.json', Buffer.from('{}'), 'application/json');
    expect((await svc.list('backups/')).sort()).toEqual(['backups/1.json', 'backups/2.json']);
  });
});
