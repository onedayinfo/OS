import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SettingsService } from '../settings/settings.service.js';
import { StorageService } from '../storage/storage.service.js';
import { BackupService } from './backup.service.js';

const DEFAULT_RETENTION = 30;

/**
 * Backup diário do banco (JSON) para o storage ativo.
 *
 * ponytail: sem lock — instância única, igual ao SlaBreachCron. Poda por nome
 * (o timestamp ISO ordena lexicograficamente).
 */
@Injectable()
export class BackupCron {
  private readonly logger = new Logger(BackupCron.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly backup: BackupService,
    private readonly storage: StorageService,
  ) {}

  @Cron('0 3 * * *')
  async run(): Promise<void> {
    if (!(await this.settings.getBool('backup.s3.enabled'))) return;
    try {
      const json = JSON.stringify(await this.backup.export());
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const name = `backups/os-backup-${stamp}.json`;
      await this.storage.put(name, Buffer.from(json), 'application/json');

      const keep = (await this.settings.getNumber('backup.retention')) ?? DEFAULT_RETENTION;
      const all = (await this.storage.list('backups/')).sort().reverse();
      for (const old of all.slice(keep)) {
        await this.storage.remove(old);
      }
      this.logger.log(`Backup gravado: ${name} (retenção ${keep})`);
    } catch (err) {
      this.logger.error(`Falha no backup diário: ${(err as Error).message}`);
    }
  }
}
