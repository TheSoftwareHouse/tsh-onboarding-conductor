import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 3000;
  const mode = configService.get<string>('MODE') || 'all';

  if (mode === 'all' || mode === 'api-only') {
    await app.listen(port);
    console.log(`Engine API is running on: http://localhost:${port} in mode [${mode}]`);
  } else if (mode === 'worker-only') {
    await app.init();
    console.log(`Engine Worker initialized without HTTP server in mode [${mode}]`);
  }
}
bootstrap();
