import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { TriageService } from './triage.service.js';
import { EvolutionStatusService } from './evolution-status.service.js';

const DEFAULT_RETENTION_DAYS = 90;

@Injectable()
export class WhatsappCron {
  private readonly logger = new Logger(WhatsappCron.name);

  constructor(
    private readonly triage: TriageService,
    private readonly status: EvolutionStatusService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  @Cron('*/5 * * * *')
  async triageRun(): Promise<void> {
    await this.triage.run();
  }

  /** Mantém o instante da queda atualizado mesmo sem ninguém olhando a tela. */
  @Cron('*/5 * * * *')
  async statusCheck(): Promise<void> {
    await this.status.check();
  }

  @Cron('30 3 * * *')
  async retention(): Promise<void> {
    const configured = await this.settings.getNumber('whatsapp.retentionDays');
    const days = configured && configured >= 1 ? configured : DEFAULT_RETENTION_DAYS;
    const cutoff = new Date(Date.now() - days * 24 * 3600_000);
    const { count } = await this.prisma.whatsappMessage.deleteMany({ where: { sentAt: { lt: cutoff } } });
    if (count) this.logger.log(`Retenção: ${count} mensagens apagadas (mais de ${days} dias).`);
  }
}
