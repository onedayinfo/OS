import { Injectable } from '@nestjs/common';
import type { MailSender } from '../users/mail-sender.js';
import { EmailService } from './email.service.js';
import { contactInvite } from './templates.js';

/** Impl real do token `'MailSender'` (Fase 3 usava o stub `LoggerMailSender`). */
@Injectable()
export class ResendMailSender implements MailSender {
  constructor(private readonly email: EmailService) {}

  async sendInvite(user: { name: string; email: string }, link: string): Promise<void> {
    await this.email.send({ to: user.email, ...contactInvite(user, link) });
  }
}
