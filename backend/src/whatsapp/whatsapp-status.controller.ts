import { Controller, Get } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { Screen, SkipScreen } from '../common/screen.decorator.js';
import { EvolutionStatusService } from './evolution-status.service.js';
import { AiUsageService } from './ai-usage.service.js';
import { TriageService } from './triage.service.js';

@Screen('config')
@Controller('whatsapp')
export class WhatsappStatusController {
  constructor(
    private readonly status: EvolutionStatusService,
    private readonly usage: AiUsageService,
    private readonly triage: TriageService,
  ) {}

  @SkipScreen()
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
