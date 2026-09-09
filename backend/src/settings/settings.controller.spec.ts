import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { SettingsController } from './settings.controller.js';

function makeSvc() {
  return {
    describe: vi.fn(async () => ({
      'branding.companyName': 'One Day',
      'resend.apiKeySet': true,
    })),
    set: vi.fn(async () => undefined),
  };
}

describe('SettingsController', () => {
  it('GET devolve describe() + encryptionKeySet', async () => {
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    const c = new SettingsController(makeSvc() as any);
    const res = await c.get();
    expect(res['branding.companyName']).toBe('One Day');
    expect(res.encryptionKeySet).toBe(true);
  });

  it('PUT grava só chaves conhecidas e rejeita chave desconhecida', async () => {
    const svc = makeSvc();
    const c = new SettingsController(svc as any);
    await c.update({ values: { 'branding.companyName': 'Nova', 'mail.from': 'a@b.com' } });
    expect(svc.set).toHaveBeenCalledWith('branding.companyName', 'Nova');
    expect(svc.set).toHaveBeenCalledWith('mail.from', 'a@b.com');

    await expect(c.update({ values: { 'chave.fantasma': 'x' } })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
