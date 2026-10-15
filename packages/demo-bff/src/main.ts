import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { AppConfig } from './config/app.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // The demo web app is the only browser origin; no admin or engine route is exposed here.
  app.enableCors({
    origin: config.get('DEMO_WEB_ORIGIN', { infer: true }),
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  await app.listen(config.get('DEMO_BFF_PORT', { infer: true }));
}

void bootstrap();
