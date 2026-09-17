import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';

/**
 * Boots the application just far enough to read its route and DTO metadata, with no
 * infrastructure at hand.
 *
 * The document is a pure function of the decorators, but Nest only exposes them through a compiled
 * module graph, and compiling `AppModule` would otherwise open a Postgres connection: TypeORM's
 * data source provider initialises on creation. Overriding that one provider is enough. Every
 * repository resolves the manager lazily per call, and the Redis connection is opened in a
 * lifecycle hook, so as long as `init()` is never called nothing reaches for the network. The app
 * is never closed either: nothing was opened, and a shutdown hook could only stumble over the stub.
 */
export async function createOpenApiApp(): Promise<INestApplication> {
  const dataSource = {
    options: { type: 'postgres' },
    manager: {},
    isInitialized: false,
    entityMetadatas: [],
    getRepository: () => ({}),
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(dataSource)
    .compile();

  return moduleRef.createNestApplication();
}
