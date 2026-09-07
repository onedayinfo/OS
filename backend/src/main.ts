import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: [process.env.APP_URL, process.env.PORTAL_URL].filter(Boolean),
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3001);
}
await bootstrap();
