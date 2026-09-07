import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SlaBreachCron } from './sla-breach.cron.js';

@Module({
  imports: [NotificationsModule],
  providers: [SlaBreachCron],
})
export class TasksModule {}
