import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/public.decorator.js';
import { SettingsService } from '../settings/settings.service.js';
import { InboundService } from './inbound.service.js';
import { ResendReceivingService } from './resend-receiving.service.js';

/** Janela de tolerância do `svix-timestamp` (anti-replay), em segundos. */
const TOLERANCE_S = 5 * 60;

/**
 * Verifica a assinatura Svix que o Resend manda nos webhooks: HMAC-SHA256 de
 * `${svix-id}.${svix-timestamp}.${corpo cru}` com a chave = base64 do segredo
 * sem o prefixo `whsec_`. `svix-signature` traz uma ou mais `v1,<base64>`
 * separadas por espaço (rotação de segredo). Fail-closed: sem segredo → false.
 */
export function verifySvixSignature(
  rawBody: Buffer | undefined,
  h: { id?: string; timestamp?: string; signature?: string },
  secret: string,
  nowMs = Date.now(),
): boolean {
  if (!rawBody || !h.id || !h.timestamp || !h.signature || !secret) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > TOLERANCE_S) return false;

  const key = Buffer.from(secret.trim().replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key)
    .update(`${h.id}.${h.timestamp}.`)
    .update(rawBody)
    .digest();

  return h.signature.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

@Public()
@Controller('webhooks/resend')
export class InboundController {
  constructor(
    private readonly inbound: InboundService,
    private readonly receiving: ResendReceivingService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Webhook `email.received` do Resend. O evento só traz metadados (`email_id`);
   * corpo, cabeçalhos e anexos são buscados na API do Resend. Falha nessa busca
   * responde 5xx para o Resend tentar de novo (o dedupe por Message-ID protege).
   */
  @Post('inbound')
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('svix-id') id: string | undefined,
    @Headers('svix-timestamp') timestamp: string | undefined,
    @Headers('svix-signature') signature: string | undefined,
  ) {
    const secret = (await this.settings.get('resend.inboundSecret')) ?? '';
    if (!verifySvixSignature(req.rawBody, { id, timestamp, signature }, secret)) {
      throw new UnauthorizedException('Assinatura do webhook inválida.');
    }
    // JSON do corpo cru (o `ValidationPipe` global com `whitelist` removeria campos aninhados).
    let event: { type?: string; data?: { email_id?: string } };
    try {
      event = JSON.parse(req.rawBody!.toString('utf8'));
    } catch {
      throw new BadRequestException('Corpo não é um JSON válido.');
    }
    // Outros eventos (envio, entrega…) podem estar assinados no mesmo webhook: ignora.
    if (event.type !== 'email.received' || !event.data?.email_id) return { ignored: true };

    const email = await this.receiving.fetch(event.data.email_id);
    return this.inbound.handle(email);
  }
}
