import { Module } from '@nestjs/common';
import { BrandingController } from './branding.controller.js';

@Module({ controllers: [BrandingController] })
export class BrandingModule {}
