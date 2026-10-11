import { Controller, Get } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { EvolutionStatusService } from './evolution-status.service.js';
import { AiUsageService } from './ai-usage.service.js';

@Controller('whatsapp')
export class WhatsappStatusController {
  constructor(
    private readonly status: EvolutionStatusService,
    private readonly usage: AiUsageService,
  ) {}

  @Get('status')
  @Roles('ADMIN', 'AGENT')
  async get() {
    const [connection, usedToday, limit] = await Promise.all([
      this.status.check(),
      this.usage.usedToday(),
      this.usage.limit(),
    ]);
    return { connection, ai: { usedToday, limit, paused: usedToday >= limit } };
  }

  @Get('qr')
  @Roles('ADMIN')
  qr() {
    return this.status.qr();
  }
}
