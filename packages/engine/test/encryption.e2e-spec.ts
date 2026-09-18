import { randomBytes, randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  MockKyc1Connector,
  MockKyc2Connector,
} from '../src/connectors/adapters/fixtures/mock-kyc.connector';
import { ConnectorExecutionResult } from '../src/connectors/ports/connector-execution.port';
import {
  BASE_WORKFLOW_AGREEMENT_KEY,
  BASE_WORKFLOW_AGREEMENT_TYPE,
  ensureAgreementPublished,
} from './agreements.support';
import { startE2eServer } from './e2e-server';

// Genuinely per-test configuration: `.env` ships with `ENCRYPTION_ENABLED=false` (or the flag
// absent entirely), so this suite injects the pair the scenario needs rather than asking anyone
// to hand-edit `.env`. Captured so the real values — whatever they are, including "unset" — can
// be restored once this file is done, leaving no encryption key behind for a spec that runs after
// it in the same `--runInBand` process.
const ORIGINAL_ENCRYPTION_ENABLED = process.env.ENCRYPTION_ENABLED;
const ORIGINAL_ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

process.env.ENCRYPTION_ENABLED = 'true';
// A fresh, random 32-byte key generated for this run only. Never logged, never asserted on,
// never reused across runs — it exists purely so `EncryptionModule` has something valid to bind.
process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');

// Placed after the environment is set, as `AppModule` (via `EncryptionModule`) reads
// `ENCRYPTION_ENABLED`/`ENCRYPTION_KEY` through `ConfigModule.forRoot()` at import time.
import { AppModule } from '../src/app.module';

/**
 * Proves the encryption feature end to end against the real Compose Postgres, with
 * `ENCRYPTION_ENABLED=true`: a raw `DataSource.query` — bypassing every TypeORM transformer —
 * sees only an opaque `{ __tsh_enc, k, d }` envelope for `onboardings.context`, the only column
 * this feature covers (`k` names the id of the data key that wrapped it, so a later key rotation
 * can find and re-encrypt this row), while the same data read back through the HTTP API is
 * identical to what was submitted.
 *
 * Every row this spec writes is scoped by an id unique to the run (a fresh onboarding uuid and
 * email) and cleaned up in `afterAll`, so the spec passes on a fresh database and on a rerun
 * against the same Compose volume alike. `afterAll` also empties `encryption_keys`: this spec's
 * own boot is the only thing that puts a row there (first-boot provisioning under this run's
 * random KEK), and a row left behind is wrapped under a KEK the *next* run's own fresh random
 * `ENCRYPTION_KEY` cannot unwrap — `EncryptionKeyRingService.reload()` then throws during
 * `onModuleInit` and the app never boots. This is cleanup of exactly what this run caused to
 * exist, never a general licence to delete keys: outside a spec tearing down after itself,
 * destroying a key's wrapped material would destroy the ability to ever read data still
 * encrypted under it.
 *
 * `.env` must NOT set `ENCRYPTION_ENABLED` (this spec injects its own value below and restores
 * whatever `.env` had in `afterAll`): setting it globally instead makes every other suite's rows
 * — and any rows already sitting in the shared Compose volume — get wrapped under whatever KEK
 * happened to be configured at the time. A ring built from a *different* `ENCRYPTION_KEY` than
 * the one that wrapped those rows cannot unwrap them, so `EncryptionModule` throws at boot the next
 * time the engine starts against that same volume, and every suite fails, not just this one.
 *
 * Requires the local stack (`pnpm stack:up`).
 */
describe('Data encryption (e2e)', () => {
  let app: NestExpressApplication | undefined;
  let dataSource: DataSource;

  const TEST_EMAIL = `encryption-e2e-${randomUUID()}@example.com`;

  const createdOnboardingIds: string[] = [];

  const getApp = (): NestExpressApplication => {
    if (!app) {
      throw new Error('Test app not initialized');
    }

    return app;
  };

  const http = () => request(getApp().getHttpServer());

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await startE2eServer(app);
    dataSource = app.get(DataSource);

    // `base` links the `base-terms` family as pending on start; a family with nothing published
    // refuses the start entirely, so this is a prerequisite of the first `POST /v1/onboardings`.
    await ensureAgreementPublished(
      getApp(),
      BASE_WORKFLOW_AGREEMENT_KEY,
      BASE_WORKFLOW_AGREEMENT_TYPE,
    );
  }, 60000);

  afterAll(async () => {
    if (app) {
      if (createdOnboardingIds.length > 0) {
        await dataSource.query('DELETE FROM onboardings WHERE id = ANY($1::uuid[])', [
          createdOnboardingIds,
        ]);
      }

      // This run's own boot is the only thing that can have put a row in `encryption_keys` (see
      // the class doc comment): `ENCRYPTION_ENABLED=false` everywhere else in the suite means no
      // other spec touches this table, so it is empty when this file starts and safe to empty
      // again when it finishes. This is cleanup of exactly what this spec caused to exist, not a
      // general licence to delete keys — deleting a row that still protects live data would make
      // that data unreadable forever.
      await dataSource.query('DELETE FROM encryption_keys');

      await app.close();
    }

    if (ORIGINAL_ENCRYPTION_ENABLED === undefined) {
      delete process.env.ENCRYPTION_ENABLED;
    } else {
      process.env.ENCRYPTION_ENABLED = ORIGINAL_ENCRYPTION_ENABLED;
    }

    if (ORIGINAL_ENCRYPTION_KEY === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = ORIGINAL_ENCRYPTION_KEY;
    }
  });

  const expectEnvelope = (value: unknown): void => {
    expect(typeof value).toBe('object');
    expect(value).not.toBeNull();
    const envelope = value as Record<string, unknown>;
    expect(Object.keys(envelope).sort()).toEqual(['__tsh_enc', 'd', 'k']);
    expect(typeof envelope.__tsh_enc).toBe('string');
    expect(typeof envelope.k).toBe('string');
    expect(typeof envelope.d).toBe('string');
  };

  it('stores onboardings.context as an opaque envelope and decrypts it correctly across two HTTP submits', async () => {
    const firstConnector = getApp().get(MockKyc1Connector);
    const secondConnector = getApp().get(MockKyc2Connector);
    // The fixture connectors always accept, but only after a 5s deliberate delay; mocking their
    // `execute` keeps this spec fast and lets it assert exactly what context each one received.
    const firstExecuteSpy = jest
      .spyOn(firstConnector, 'execute')
      .mockResolvedValue(ConnectorExecutionResult.accepted());
    const secondExecuteSpy = jest
      .spyOn(secondConnector, 'execute')
      .mockResolvedValue(ConnectorExecutionResult.accepted());

    const startResponse = await http()
      .post('/v1/onboardings')
      .send({ workflowId: 'base' })
      .expect(201);
    const onboardingId = startResponse.body.onboardingId as string;
    createdOnboardingIds.push(onboardingId);

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ email: TEST_EMAIL })
      .expect((response) => expect([200, 201]).toContain(response.status));

    expect(firstExecuteSpy).toHaveBeenCalledWith(
      expect.objectContaining({ context: { email: TEST_EMAIL } }),
    );

    // Bypasses every TypeORM transformer: raw SQL sees exactly what Postgres holds.
    const rawRows = await dataSource.query<Array<{ context: Record<string, unknown> }>>(
      'SELECT context FROM onboardings WHERE id = $1',
      [onboardingId],
    );
    expect(rawRows).toHaveLength(1);
    expectEnvelope(rawRows[0].context);
    expect(JSON.stringify(rawRows[0].context)).not.toContain(TEST_EMAIL);

    // A second submit forces `OnboardingsService` to read the just-encrypted row back
    // (`onboardingsRepository.findById`, through the transformer), merge the new field into the
    // decrypted context, and hand the *whole* context to the next connector — proving the
    // decrypt round trip through the live API rather than by calling the transformer directly.
    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((response) => expect([200, 201]).toContain(response.status));

    expect(secondExecuteSpy).toHaveBeenCalledWith(
      expect.objectContaining({ context: { email: TEST_EMAIL, acceptedTerms: true } }),
    );
  });
});
