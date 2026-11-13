import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Resend } from 'resend';
import { SettingsService } from '../settings/settings.service.js';
import type { ResendInboundAttachment, ResendInboundEmail } from './dto/resend-inbound.dto.js';

/** HTML → texto simples (o chamado guarda texto). ponytail: regex, sem parser. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Busca o e-mail recebido (corpo, cabeçalhos, anexos) na API de Receiving do Resend. */
@Injectable()
export class ResendReceivingService {
  private readonly logger = new Logger('ResendReceiving');

  constructor(private readonly settings: SettingsService) {}

  async fetch(emailId: string): Promise<ResendInboundEmail> {
    const apiKey = await this.settings.get('resend.apiKey');
    if (!apiKey) {
      throw new ServiceUnavailableException('Chave da API do Resend não configurada.');
    }
    const resend = new Resend(apiKey);

    // `cid`: imagens inline ficam como referência, não como data URI gigante no HTML.
    const { data, error } = await resend.emails.receiving.get(emailId, { html_format: 'cid' });
    if (error || !data) {
      throw new BadGatewayException(
        `Falha ao buscar o e-mail ${emailId} no Resend: ${error?.message ?? 'sem dados'}`,
      );
    }

    const attachments: ResendInboundAttachment[] = [];
    if (data.attachments?.length) {
      const list = await resend.emails.receiving.attachments.list({ emailId });
      if (list.error) {
        throw new BadGatewayException(`Falha ao listar anexos de ${emailId}: ${list.error.message}`);
      }
      for (const a of list.data?.data ?? []) {
        // Imagem inline de assinatura de e-mail não vira anexo do chamado.
        if (a.content_disposition === 'inline') continue;
        try {
          const res = await fetch(a.download_url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          attachments.push({
            filename: a.filename ?? 'anexo',
            content_type: a.content_type,
            content: Buffer.from(await res.arrayBuffer()).toString('base64'),
          });
        } catch (err) {
          this.logger.warn(`anexo "${a.filename}" de ${emailId} ignorado: ${(err as Error).message}`);
        }
      }
    }

    return {
      from: data.from,
      subject: data.subject,
      text: data.text?.trim() ? data.text : htmlToText(data.html),
      headers: data.headers ?? {},
      message_id: data.message_id,
      attachments,
    };
  }
}
