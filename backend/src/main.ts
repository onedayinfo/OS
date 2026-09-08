import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

async function bootstrap() {
  // `rawBody: true` preenche `req.rawBody` com os bytes originais da requisição
  // (usado pela verificação de assinatura HMAC do webhook inbound do Resend em
  // InboundController).
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix('api');
  // Atrás do Cloudflare Tunnel → cloudflared → container `frontend` (proxy do
  // Next). Confia em 1 hop de proxy para `req.ip` / `X-Forwarded-For` valerem.
  // `getInstance()` devolve o app Express cru — evita tipar o generic e mexer
  // nas assinaturas de `enableCors`.
  (app.getHttpAdapter().getInstance() as { set(k: string, v: unknown): void }).set(
    'trust proxy',
    1,
  );
  // helmet com config padrão. contentSecurityPolicy desligado: a CSP default do
  // helmet quebraria o front (SPA em origin separada + assets), e o front já é
  // servido pelo Next, não por este backend de API.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Guards globais (JwtAuthGuard antes de RolesGuard) são registrados como APP_GUARD no CommonModule.
  app.enableCors({
    origin: [process.env.APP_URL, process.env.PORTAL_URL].filter(Boolean),
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3001);
}
await bootstrap();
