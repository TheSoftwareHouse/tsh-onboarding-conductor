import { ValidationPipe, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

export async function createApp(module: Type<unknown> = AppModule) {
  const app = await NestFactory.create<NestExpressApplication>(module, { bodyParser: false });
  app.useBodyParser('json', { strict: false });
  app.useBodyParser('urlencoded', { extended: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 3000;
  const mode = configService.get<string>('MODE') || 'all';
  const adminPanelOrigin = configService.getOrThrow<string>('ADMIN_PANEL_ORIGIN');

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || origin === adminPanelOrigin) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    methods: ['GET', 'OPTIONS'],
    credentials: false,
  });

  return { app, port, mode };
}

export async function bootstrap() {
  const { app, port, mode } = await createApp();

  if (mode === 'all' || mode === 'api-only') {
    await app.listen(port);
    console.log(`Engine API is running on: http://localhost:${port} in mode [${mode}]`);
  } else if (mode === 'worker-only') {
    await app.init();
    console.log(`Engine Worker initialized without HTTP server in mode [${mode}]`);
  }
}

if (require.main === module) {
  void bootstrap();
}
