import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { SettingsService } from '../settings/settings.service.js';
import type { BrandInfo } from './templates.js';

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
  // ponytail: memoiza o client Resend por chave — recria só se a chave mudar.
  private client?: Resend;
  private clientKey?: string;

  constructor(private readonly settings: SettingsService) {}

  /**
   * Envia um e-mail transacional via Resend. Sem chave configurada (banco nem
   * env) vira no-op logado. Erro do Resend é logado e NÃO propaga — notificação
   * não pode derrubar a request que a disparou.
   */
  async send({ to, subject, html, headers, replyTo }: SendEmailInput): Promise<void> {
    const cfg = await this.settings.getMany(['resend.apiKey', 'mail.from']);
    const apiKey = cfg['resend.apiKey'];
    const from = cfg['mail.from'] ?? '';

    if (!apiKey) {
      this.logger.warn(`[email] RESEND_API_KEY ausente — e-mail não enviado: ${subject} -> ${to}`);
      return;
    }

    try {
      if (!this.client || this.clientKey !== apiKey) {
        this.client = new Resend(apiKey);
        this.clientKey = apiKey;
      }
      const { error } = await this.client.emails.send({
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

  /** Marca (nome + URL absoluta do logo) para os templates. `logoUrl` só quando há logo salvo. */
  async brand(): Promise<BrandInfo> {
    const [companyName, logo] = await Promise.all([
      this.settings.get('branding.companyName'),
      this.settings.get('branding.logoData'),
    ]);
    const appUrl = process.env.APP_URL ?? '';
    return {
      companyName: companyName || undefined,
      logoUrl: logo && appUrl ? `${appUrl}/api/branding/logo` : undefined,
    };
  }
}
