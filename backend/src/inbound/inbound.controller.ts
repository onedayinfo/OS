import { createHmac, timingSafeEqual } from 'node:crypto';
import {
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
import type { ResendInboundPayload } from './dto/resend-inbound.dto.js';

/**
 * Verifica a assinatura do webhook: HMAC-SHA256 do corpo cru com o segredo
 * inbound (config `resend.inboundSecret`, fallback `RESEND_INBOUND_SECRET`),
 * comparado (timing-safe) ao header. Fail-closed: sem secret, nada casa → 401.
 *
 * ponytail: aceitamos o header `x-resend-signature` com HMAC hex simples. O
 * webhook real do Resend usa Svix (`svix-signature`, esquema `v1,<base64>`); ao
 * conectar o webhook de verdade isto vai precisar do pacote `svix`. Não
 * adicionado agora (fora do escopo do MVP local).
 */
export function verifyResendSignature(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!rawBody || !signature) return false;
  const expected = createHmac('sha256', secret ?? '').update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

@Public()
@Controller('webhooks/resend')
export class InboundController {
  constructor(
    private readonly inbound: InboundService,
    private readonly settings: SettingsService,
  ) {}

  @Post('inbound')
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-resend-signature') signature: string | undefined,
  ) {
    const secret = (await this.settings.get('resend.inboundSecret')) ?? '';
    if (!verifyResendSignature(req.rawBody, signature, secret)) {
      throw new UnauthorizedException('Assinatura do webhook inválida.');
    }
    // Lê o JSON do corpo cru (o `ValidationPipe` global com `whitelist: true`
    // removeria os campos aninhados do payload do Resend).
    const payload = JSON.parse(req.rawBody!.toString('utf8')) as ResendInboundPayload;
    return this.inbound.handle(payload);
  }
}
