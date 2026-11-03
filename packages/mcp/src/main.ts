import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = app.get(ConfigService).getOrThrow<number>('MCP_PORT');

  await app.listen(port);
  console.log(`MCP server is running on: http://localhost:${port}`);
}

if (require.main === module) {
  void bootstrap();
}
