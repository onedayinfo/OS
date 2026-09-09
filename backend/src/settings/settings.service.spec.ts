import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from './settings.service.js';

const KEY = Buffer.alloc(32, 3).toString('base64');

function makePrisma(rows: Record<string, { value: string; encrypted: boolean }> = {}) {
  const store = new Map(Object.entries(rows));
  return {
    setting: {
      findMany: vi.fn(async () =>
        [...store].map(([key, v]) => ({ key, ...v, updatedAt: new Date() })),
      ),
      findUnique: vi.fn(async ({ where: { key } }: any) =>
        store.has(key) ? { key, ...store.get(key)!, updatedAt: new Date() } : null,
      ),
      upsert: vi.fn(async ({ where: { key }, create, update }: any) => {
        store.set(key, {
          value: (create ?? update).value,
          encrypted: !!(create ?? update).encrypted,
        });
      }),
      delete: vi.fn(async ({ where: { key } }: any) => void store.delete(key)),
    },
    __store: store,
  };
}

describe('SettingsService', () => {
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_FROM;
  });

  it('get cai pro env legado quando a chave não está no banco', async () => {
    process.env.MAIL_FROM = 'suporte@x.com';
    const svc = new SettingsService(makePrisma() as any);
    expect(await svc.get('mail.from')).toBe('suporte@x.com');
  });

  it('valor do banco tem precedência sobre o env legado', async () => {
    process.env.MAIL_FROM = 'env@x.com';
    const svc = new SettingsService(
      makePrisma({ 'mail.from': { value: 'db@x.com', encrypted: false } }) as any,
    );
    expect(await svc.get('mail.from')).toBe('db@x.com');
  });

  it('set de segredo grava blob criptografado; get descriptografa', async () => {
    const prisma = makePrisma();
    const svc = new SettingsService(prisma as any);
    await svc.set('resend.apiKey', 'rk_live_x');
    expect(prisma.__store.get('resend.apiKey')!.encrypted).toBe(true);
    expect(prisma.__store.get('resend.apiKey')!.value.startsWith('v1:')).toBe(true);
    expect(await svc.get('resend.apiKey')).toBe('rk_live_x');
  });

  it('set de segredo com string vazia é no-op (não apaga o que já existe)', async () => {
    const prisma = makePrisma();
    const svc = new SettingsService(prisma as any);
    await svc.set('resend.apiKey', 'rk_1');
    await svc.set('resend.apiKey', '');
    expect(await svc.get('resend.apiKey')).toBe('rk_1');
  });

  it('cache invalida no set (segundo get reflete o novo valor)', async () => {
    const prisma = makePrisma({ 'branding.companyName': { value: 'Antiga', encrypted: false } });
    const svc = new SettingsService(prisma as any);
    expect(await svc.get('branding.companyName')).toBe('Antiga');
    await svc.set('branding.companyName', 'Nova');
    expect(await svc.get('branding.companyName')).toBe('Nova');
  });

  it('describe nunca devolve valor de segredo, só o booleano <key>Set', async () => {
    const svc = new SettingsService(
      makePrisma({
        'resend.apiKey': { value: 'v1:a:b:c', encrypted: true },
        'branding.companyName': { value: 'One Day', encrypted: false },
      }) as any,
    );
    const view = await svc.describe();
    expect(view['branding.companyName']).toBe('One Day');
    expect(view['resend.apiKeySet']).toBe(true);
    expect(view['resend.apiKey']).toBeUndefined();
  });
});
