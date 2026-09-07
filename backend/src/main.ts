import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';

async function bootstrap() {
  // `rawBody: true` preenche `req.rawBody` com os bytes originais da requisição
  // (usado pela verificação de assinatura HMAC do webhook inbound do Resend em
  // InboundController).
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix('api');
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
