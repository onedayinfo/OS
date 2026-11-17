import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SettingsService } from '../settings/settings.service.js';
import { AuditService } from './audit.service.js';

const DEFAULT_RETENTION_DAYS = 90;

/** Apaga diariamente os logs de auditoria mais antigos que `audit.retentionDays` (padrão 90). */
@Injectable()
export class AuditRetentionCron {
  private readonly logger = new Logger(AuditRetentionCron.name);

  constructor(
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  @Cron('30 3 * * *')
  async run(): Promise<void> {
    const n = Number(await this.settings.get('audit.retentionDays'));
    const days = Number.isFinite(n) && n > 0 ? n : DEFAULT_RETENTION_DAYS;
    const apagados = await this.audit.purgeOlderThan(days);
    this.logger.log(`Auditoria: ${apagados} registros antigos apagados.`);
  }
}
