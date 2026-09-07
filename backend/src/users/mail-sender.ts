import { Injectable, Logger } from '@nestjs/common';

/** Token de injeção: `@Inject('MailSender')`. Trocado pelo EmailService real na Fase 8. */
export interface MailSender {
  sendInvite(user: { name: string; email: string }, link: string): Promise<void>;
}

@Injectable()
export class LoggerMailSender implements MailSender {
  private readonly logger = new Logger('MailSender');

  // ponytail: stub da Fase 3 — só loga o link do convite.
  async sendInvite(user: { name: string; email: string }, link: string): Promise<void> {
    this.logger.log(`Convite para ${user.email}: ${link}`);
  }
}
