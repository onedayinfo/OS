import { Controller, Get, NotFoundException, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/public.decorator.js';
import { SettingsService } from '../settings/settings.service.js';

@Controller('branding')
@Public()
export class BrandingController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  async info() {
    const [companyName, primaryColor, logo] = await Promise.all([
      this.settings.get('branding.companyName'),
      this.settings.get('branding.primaryColor'),
      this.settings.get('branding.logoData'),
    ]);
    return {
      companyName: companyName ?? null,
      primaryColor: primaryColor ?? null,
      hasLogo: !!logo,
      logoUrl: '/api/branding/logo',
    };
  }

  @Get('logo')
  async logo(@Res() res: Response) {
    const [data, mime] = await Promise.all([
      this.settings.get('branding.logoData'),
      this.settings.get('branding.logoMime'),
    ]);
    if (!data) throw new NotFoundException('Logo não configurado.');
    res.setHeader('Content-Type', mime || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.end(Buffer.from(data, 'base64'));
  }
}
