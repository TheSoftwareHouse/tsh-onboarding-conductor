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

// Same per-test-configuration reasoning as `encryption.e2e-spec.ts`: `.env` ships with
// `ENCRYPTION_ENABLED=false`, so this suite injects its own pair and restores whatever `.env`
// had once it is done, rather than asking anyone to hand-edit `.env`.
const ORIGINAL_ENCRYPTION_ENABLED = process.env.ENCRYPTION_ENABLED;
const ORIGINAL_ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
// `test/setup-e2e-env.cjs` sets `MODE=api-only` for every suite, and `stack:integration:up`
// (what `pnpm test:e2e` brings up) deliberately runs `engine` without `engine-worker` — so with
// no override here, nothing anywhere ever runs `ReEncryptionService`'s sweep and this scenario
// can never pass. `MODE=all` starts the sweep in this same in-process app that also serves the
// `POST /v1/admin/encryption/keys` this spec needs.
const ORIGINAL_MODE = process.env.MODE;
// The two intervals `ReEncryptionService` and `EncryptionKeyRingService` read: at their
// production defaults (15000ms, 5000ms) this scenario is genuinely slow, not just given a
// generous bound; injected here at their documented minimums (`app.config.ts`) — the same repo
// convention this suite already follows for `ENCRYPTION_ENABLED`/`ENCRYPTION_KEY` — so the
// rotation's grace window and the sweep's own post-activation wait are seconds, not tens of
// seconds.
const ORIGINAL_KEY_RING_REFRESH_INTERVAL_MS = process.env.ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS;
const ORIGINAL_REENCRYPTION_POLL_INTERVAL_MS = process.env.ENCRYPTION_REENCRYPTION_POLL_INTERVAL_MS;

process.env.ENCRYPTION_ENABLED = 'true';
// A fresh, random 32-byte key generated for this run only — this file's own key-encryption key,
// independent of whatever `encryption.e2e-spec.ts` generated for itself earlier in the same
// `--runInBand` process. Never logged, never asserted on, never reused across runs.
process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.MODE = 'all';
process.env.ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS = '1000';
process.env.ENCRYPTION_REENCRYPTION_POLL_INTERVAL_MS = '500';

// Placed after the environment is set, as `AppModule` (via `EncryptionModule`) reads
// `ENCRYPTION_ENABLED`/`ENCRYPTION_KEY`/`MODE`/the two interval settings through
// `ConfigModule.forRoot()` at import time.
import { AppModule } from '../src/app.module';

/** Generous upper bound: with the ring refresh and sweep poll intervals injected above (1000ms,
 * 500ms), a rotation's new key becomes active — and the sweep processes its first batch — within
 * a few seconds of `POST /v1/admin/encryption/keys` returning (see
 * `EncryptionAdminService.addKey`'s activation grace window and
 * `ReEncryptionService.hasWaitedLongEnoughSinceObserving`), so this bound is generous rather than
 * marginal. */
const ROTATION_POLL_TIMEOUT_MS = 30000;
const ROTATION_POLL_INTERVAL_MS = 1000;
const TEST_TIMEOUT_MS = ROTATION_POLL_TIMEOUT_MS + 30000;

/**
 * Proves key rotation end to end against the real Compose Postgres — the case the reviewer found
 * 1766 unit tests could not catch, because the sweep's original `repository.save()` dirty-checked
 * the *decrypted* entity property, saw it unchanged, and silently issued no `UPDATE`, so rotation
 * audited a row moved while leaving it on the old key. Nothing here mocks TypeORM or the sweep's
 * SQL: it reads `onboardings.context ->> 'k'` directly from Postgres, before and after rotation,
 * so a regression back to `save()` — or any other change that stops the sweep from actually
 * issuing a `SET` — fails this spec rather than passing it.
 *
 * Also proves, against the live database rather than a simulation of its semantics in JavaScript,
 * that `uq_encryption_keys_active` really is enforced by Postgres: a second `INSERT` naming
 * `deleted_at IS NULL` is rejected with a unique violation, not merely refused by application code
 * that happens to check first.
 *
 * Every row this spec writes is scoped to this run (a fresh onboarding uuid) and cleaned up in
 * `afterAll`, alongside every row this run put in `encryption_keys` — see that hook's comment and
 * `encryption.e2e-spec.ts`'s class doc comment for why a leftover row there fails the *next* run's
 * boot, not just this one's.
 *
 * Requires the local stack (`pnpm stack:up`).
 */
describe('Encryption key rotation (e2e)', () => {
  let app: NestExpressApplication | undefined;
  let dataSource: DataSource;

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

      // This spec's own boot and its rotations are the only things that put rows in
      // `encryption_keys` — no other suite runs with `ENCRYPTION_ENABLED=true`, so the table is
      // empty when this file starts and safe to empty again now. This is cleanup of exactly what
      // this run caused to exist, never a general licence to delete keys: a row left protecting
      // live data would make that data unreadable forever once its material is gone.
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

    if (ORIGINAL_MODE === undefined) {
      delete process.env.MODE;
    } else {
      process.env.MODE = ORIGINAL_MODE;
    }

    if (ORIGINAL_KEY_RING_REFRESH_INTERVAL_MS === undefined) {
      delete process.env.ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS;
    } else {
      process.env.ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS = ORIGINAL_KEY_RING_REFRESH_INTERVAL_MS;
    }

    if (ORIGINAL_REENCRYPTION_POLL_INTERVAL_MS === undefined) {
      delete process.env.ENCRYPTION_REENCRYPTION_POLL_INTERVAL_MS;
    } else {
      process.env.ENCRYPTION_REENCRYPTION_POLL_INTERVAL_MS = ORIGINAL_REENCRYPTION_POLL_INTERVAL_MS;
    }
  });

  const readRawContext = async (onboardingId: string): Promise<Record<string, unknown>> => {
    const rows = await dataSource.query<Array<{ context: Record<string, unknown> }>>(
      'SELECT context FROM onboardings WHERE id = $1',
      [onboardingId],
    );
    expect(rows).toHaveLength(1);

    return rows[0].context;
  };

  const readRawUpdatedAt = async (onboardingId: string): Promise<string> => {
    const rows = await dataSource.query<Array<{ updated_at: Date }>>(
      'SELECT updated_at FROM onboardings WHERE id = $1',
      [onboardingId],
    );
    expect(rows).toHaveLength(1);

    return new Date(rows[0].updated_at).toISOString();
  };

  const waitUntil = async (
    condition: () => Promise<boolean>,
    timeoutMs: number,
    intervalMs: number,
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await condition()) {
        return;
      }

      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
  };

  it(
    'moves an onboarding onto a rotated key, preserving updated_at, without losing readability',
    async () => {
      const firstConnector = getApp().get(MockKyc1Connector);
      const secondConnector = getApp().get(MockKyc2Connector);
      // The fixture connectors always accept, but only after a 5s deliberate delay; mocking their
      // `execute` keeps this spec's own submits fast — the delay this test cannot avoid is the
      // sweep's, not the connectors'.
      const firstExecuteSpy = jest
        .spyOn(firstConnector, 'execute')
        .mockResolvedValue(ConnectorExecutionResult.accepted());
      const secondExecuteSpy = jest
        .spyOn(secondConnector, 'execute')
        .mockResolvedValue(ConnectorExecutionResult.accepted());

      const testEmail = `encryption-rotation-e2e-${randomUUID()}@example.com`;

      const startResponse = await http()
        .post('/v1/onboardings')
        .send({ workflowId: 'base' })
        .expect(201);
      const onboardingId = startResponse.body.onboardingId as string;
      createdOnboardingIds.push(onboardingId);

      await http()
        .post(`/v1/onboardings/${onboardingId}/submit`)
        .send({ email: testEmail })
        .expect((response) => expect([200, 201]).toContain(response.status));

      expect(firstExecuteSpy).toHaveBeenCalledWith(
        expect.objectContaining({ context: { email: testEmail } }),
      );

      const contextBeforeRotation = await readRawContext(onboardingId);
      const originalKeyId = contextBeforeRotation.k as string;
      expect(typeof originalKeyId).toBe('string');
      const updatedAtBeforeRotation = await readRawUpdatedAt(onboardingId);

      // The rotation itself: soft-deletes the active key and inserts a new one in one
      // transaction. The new key's id is returned; it is not yet the one `encrypt` uses (see
      // `EncryptionAdminService.addKey`'s activation-grace-window doc comment) and the sweep will
      // not touch its first batch until well after that.
      const rotateResponse = await http().post('/v1/admin/encryption/keys').send({}).expect(201);
      const newKeyId = rotateResponse.body.id as string;
      expect(newKeyId).not.toBe(originalKeyId);

      // Proves the bug class the reviewer flagged: only a real `SELECT` against Postgres, after
      // the sweep has actually had a chance to run, can show the stored envelope's key id moved.
      // A sweep that regressed to `repository.save()` would leave `contextAfterRotation.k`
      // unchanged forever, and this assertion — not a mocked report of sweep "success" — is what
      // would fail.
      await waitUntil(
        async () => {
          const context = await readRawContext(onboardingId);
          return context.k === newKeyId;
        },
        ROTATION_POLL_TIMEOUT_MS,
        ROTATION_POLL_INTERVAL_MS,
      );

      const contextAfterRotation = await readRawContext(onboardingId);
      expect(contextAfterRotation.k).toBe(newKeyId);
      expect(contextAfterRotation.k).not.toBe(originalKeyId);

      // The fix from the previous pass, proved end to end: the sweep's write carries `updatedAt`
      // through unchanged (`ReEncryptionService`'s `onboardingRepository.update` call), so a row
      // moved by rotation must not read as though an operator just touched it.
      const updatedAtAfterRotation = await readRawUpdatedAt(onboardingId);
      expect(updatedAtAfterRotation).toBe(updatedAtBeforeRotation);

      // Data still reads correctly through the API once the row has actually moved onto the new
      // key: a further submit forces `OnboardingsService` to decrypt the now-rotated row (through
      // the transformer, resolving `newKeyId` from the ring), merge the new field in, and hand the
      // whole context to the next connector.
      await http()
        .post(`/v1/onboardings/${onboardingId}/submit`)
        .send({ acceptedTerms: true })
        .expect((response) => expect([200, 201]).toContain(response.status));

      expect(secondExecuteSpy).toHaveBeenCalledWith(
        expect.objectContaining({ context: { email: testEmail, acceptedTerms: true } }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it('rejects a second row naming deleted_at IS NULL with a unique violation', async () => {
    // By the time this runs, the app's own first-boot provisioning (or the rotation test above)
    // has already left exactly one row with `deleted_at IS NULL` — `uq_encryption_keys_active`'s
    // whole point is that Postgres itself refuses a second one, not that application code merely
    // simulates that refusal. `wrapped_key` never needs to be valid material for this: the unique
    // index rejects the `INSERT` before any value is ever read back out of the column.
    await expect(
      dataSource.query(
        `INSERT INTO encryption_keys (id, wrapped_key, activated_at, deleted_at)
         VALUES (gen_random_uuid(), 'not-a-real-wrapped-key', now(), NULL)`,
      ),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'uq_encryption_keys_active',
    });
  });
});
