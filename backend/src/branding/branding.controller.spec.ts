import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { BrandingController } from './branding.controller.js';

function svc(map: Record<string, string | undefined>) {
  return { get: vi.fn(async (k: string) => map[k]) };
}

describe('BrandingController', () => {
  it('GET /branding reflete nome, cor e hasLogo', async () => {
    const c = new BrandingController(
      svc({
        'branding.companyName': 'One Day',
        'branding.primaryColor': '#0a0',
        'branding.logoData': 'AAAA',
      }) as any,
    );
    expect(await c.info()).toEqual({
      companyName: 'One Day',
      primaryColor: '#0a0',
      hasLogo: true,
      logoUrl: '/api/branding/logo',
    });
  });

  it('GET /branding/logo sem logo -> 404', async () => {
    const c = new BrandingController(svc({}) as any);
    const res = { setHeader: vi.fn(), end: vi.fn() } as any;
    await expect(c.logo(res)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('GET /branding/logo devolve bytes com o mime salvo', async () => {
    const png = Buffer.from('PNGDATA').toString('base64');
    const c = new BrandingController(
      svc({ 'branding.logoData': png, 'branding.logoMime': 'image/png' }) as any,
    );
    const res = { setHeader: vi.fn(), end: vi.fn() } as any;
    await c.logo(res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=300');
    expect(res.end).toHaveBeenCalledWith(Buffer.from('PNGDATA'));
  });
});
