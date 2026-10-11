import { createHash, timingSafeEqual } from 'node:crypto';
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
import { WhatsappService } from './whatsapp.service.js';
import { parseEvolutionMessage } from './evolution-payload.js';

/** Compara em tempo constante (hash dos dois lados iguala o tamanho). Fail-closed sem segredo. */
export function verifyWebhookSecret(received: string | undefined, expected: string): boolean {
  if (!received || !expected) return false;
  const a = createHash('sha256').update(received).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

@Public()
@Controller('whatsapp')
export class WhatsappWebhookController {
  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly settings: SettingsService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-webhook-secret') secret: string | undefined,
  ) {
    const expected = (await this.settings.get('whatsapp.webhookSecret')) ?? '';
    if (!verifyWebhookSecret(secret, expected)) {
      throw new UnauthorizedException('Segredo do webhook inválido.');
    }
    // JSON do corpo cru: o ValidationPipe global (whitelist) removeria os campos aninhados.
    let payload: unknown;
    try {
      payload = JSON.parse(req.rawBody?.toString('utf8') ?? '');
    } catch {
      throw new BadRequestException('Corpo não é um JSON válido.');
    }
    const parsed = parseEvolutionMessage(payload);
    if (!parsed) return { ignored: true };
    return this.whatsapp.ingest(parsed);
  }
}
