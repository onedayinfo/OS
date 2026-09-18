import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { BackupModule } from '../backup/backup.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { SlaModule } from '../sla/sla.module.js';
import { SlaBreachCron } from './sla-breach.cron.js';
import { BackupCron } from '../backup/backup.cron.js';
import { ContractPreventiveCron } from './contract-preventive.cron.js';

@Module({
  imports: [NotificationsModule, BackupModule, TicketsModule, SlaModule],
  providers: [SlaBreachCron, BackupCron, ContractPreventiveCron],
})
export class TasksModule {}
