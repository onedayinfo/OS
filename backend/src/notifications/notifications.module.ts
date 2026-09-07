import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [EmailModule],
  providers: [
    NotificationsService,
    { provide: 'TicketNotifier', useExisting: NotificationsService },
  ],
  exports: [NotificationsService, 'TicketNotifier'],
})
export class NotificationsModule {}
