import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

describe('OpenAPI document (e2e)', () => {
  let app: NestExpressApplication | undefined;

  beforeAll(async () => {
    process.env.ADMIN_AUTH_ENABLED = 'false';

    const { AppModule } = await import('../src/app.module');
    const { buildOpenApiDocument, serveOpenApiDocument } =
      await import('../src/openapi/openapi-document');

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>(undefined, {
      bodyParser: false,
    });
    app.useBodyParser('json', { strict: false });
    // The same wiring `createApp` does in main.ts.
    serveOpenApiDocument(app, buildOpenApiDocument(app));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves the committed document as JSON at /v1/openapi.json', async () => {
    const response = await request(app!.getHttpServer())
      .get('/v1/openapi.json')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    const committed: unknown = JSON.parse(
      readFileSync(resolve(__dirname, '../../shared/openapi/engine.openapi.json'), 'utf8'),
    );

    expect(response.body).toEqual(committed);
  });

  it('serves no Swagger UI', async () => {
    await request(app!.getHttpServer()).get('/v1/openapi').expect(404);
  });
});
