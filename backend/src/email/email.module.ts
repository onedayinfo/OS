import { Module } from '@nestjs/common';
import { EmailService } from './email.service.js';
import { ResendMailSender } from './resend-mail-sender.js';

@Module({
  providers: [EmailService, { provide: 'MailSender', useClass: ResendMailSender }],
  exports: [EmailService, 'MailSender'],
})
export class EmailModule {}
