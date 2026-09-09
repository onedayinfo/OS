import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { BackupModule } from '../backup/backup.module.js';
import { SlaBreachCron } from './sla-breach.cron.js';
import { BackupCron } from '../backup/backup.cron.js';

@Module({
  imports: [NotificationsModule, BackupModule],
  providers: [SlaBreachCron, BackupCron],
})
export class TasksModule {}
