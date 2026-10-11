import { Controller, Get } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { EvolutionStatusService } from './evolution-status.service.js';
import { AiUsageService } from './ai-usage.service.js';
import { TriageService } from './triage.service.js';

@Controller('whatsapp')
export class WhatsappStatusController {
  constructor(
    private readonly status: EvolutionStatusService,
    private readonly usage: AiUsageService,
    private readonly triage: TriageService,
  ) {}

  @Get('status')
  @Roles('ADMIN', 'AGENT')
  async get() {
    const [connection, usage] = await Promise.all([this.status.check(), this.usage.snapshot()]);
    return { connection, ai: { ...usage, lastError: this.triage.getLastError() } };
  }

  @Get('qr')
  @Roles('ADMIN')
  qr() {
    return this.status.qr();
  }
}
