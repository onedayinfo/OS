import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  headers?: Record<string, string>;
  replyTo?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger('EmailService');

  /**
   * Envia um e-mail transacional via Resend. Sem `RESEND_API_KEY` (dev/teste)
   * vira no-op logado. Erro do Resend é logado e NÃO propaga — notificação não
   * pode derrubar a request que a disparou.
   */
  async send({ to, subject, html, headers, replyTo }: SendEmailInput): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM ?? '';

    if (!apiKey) {
      this.logger.warn(`[email] RESEND_API_KEY ausente — e-mail não enviado: ${subject} -> ${to}`);
      return;
    }

    try {
      const { error } = await new Resend(apiKey).emails.send({
        from,
        to,
        subject,
        html,
        replyTo: replyTo ?? from,
        headers,
      });
      if (error) {
        this.logger.error(`[email] Resend recusou "${subject}" -> ${to}: ${error.message}`);
      }
    } catch (err) {
      this.logger.error(`[email] falha ao enviar "${subject}" -> ${to}: ${(err as Error).message}`);
    }
  }
}
