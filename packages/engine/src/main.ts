import { ValidationPipe, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

const ASYNC_CALLBACK_ROUTE_PREFIX = '/v1/webhooks';

type RequestLike = {
  originalUrl?: string;
  url?: string;
  is?(type: string | string[]): string | false | null;
};

function isAsyncCallbackRequest(request: RequestLike): boolean {
  const pathWithQuery = request.originalUrl || request.url || '';
  const path = pathWithQuery.split('?')[0];

  return path === ASYNC_CALLBACK_ROUTE_PREFIX || path.startsWith(`${ASYNC_CALLBACK_ROUTE_PREFIX}/`);
}

export async function createApp(module: Type<unknown> = AppModule) {
  const app = await NestFactory.create<NestExpressApplication>(module, { bodyParser: false });
  app.useBodyParser('raw', {
    type: (req) => isAsyncCallbackRequest(req as RequestLike),
  });

  app.useBodyParser('json', {
    strict: false,
    type: (req) => {
      const request = req as RequestLike;

      return (
        !isAsyncCallbackRequest(request) &&
        Boolean(request.is?.(['application/json', 'application/*+json']))
      );
    },
  });
  app.useBodyParser('urlencoded', {
    extended: true,
    type: (req) => {
      const request = req as RequestLike;

      return (
        !isAsyncCallbackRequest(request) &&
        Boolean(request.is?.('application/x-www-form-urlencoded'))
      );
    },
  });

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
    // The admin panel's Connectors tab writes settings with PATCH, clears them with DELETE,
    // and PUT stays available for a wholesale replace, so a read-only allowlist blocks the
    // write path at the preflight — a browser never even sends the request. A route added
    // here without its method belongs on this list too: `curl` ignores CORS, so a manual
    // check of a new route passes while the panel still cannot reach it.
    methods: ['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // The admin panel sends a bearer token, so every admin request is now preceded by a
    // preflight. Listing the header explicitly keeps that working where the default
    // request-header reflection is not available.
    allowedHeaders: ['Authorization', 'Content-Type'],
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
