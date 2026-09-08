import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import type { INestApplication } from '@nestjs/common';

// IP real do cliente. Atrás do Cloudflare Tunnel o IP verdadeiro chega em
// `CF-Connecting-IP`; se não houver, o primeiro item de `X-Forwarded-For`;
// em acesso direto / dev, cai em `req.ip` (já resolvido pelo `trust proxy`).
export const clientIp = (req: Request): string =>
  (req.headers['cf-connecting-ip'] as string) ||
  ((req.headers['x-forwarded-for'] as string) || '').split(',')[0].trim() ||
  req.ip ||
  'unknown';

const base = {
  windowMs: 60_000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  message: { statusCode: 429, message: 'Muitas tentativas, tente de novo em instantes.' },
} as const;

// ponytail: store em memória do express-rate-limit. Instância única — serve.
// Multi-instância precisaria de store compartilhado (Redis).
// `app.use(path, mw)` do INestApplication delega ao Express subjacente.
export function setupRateLimit(app: INestApplication): void {
  const strict = rateLimit({ ...base, max: 10 }); // login + set-password
  const forgot = rateLimit({ ...base, max: 5 });

  app.use('/api/auth/login', strict);
  app.use('/api/auth/set-password', strict);
  app.use('/api/auth/forgot-password', forgot);
  // NÃO limitamos /api/auth/refresh (o SPA chama com frequência) nem
  // /api/webhooks/resend/inbound (HMAC-gated, Resend faz burst).
}
