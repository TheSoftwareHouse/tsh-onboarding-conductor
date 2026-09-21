import { createHash, randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppMode } from '../src/config/app.config';
import {
  MockKyc1Connector,
  MockKyc2Connector,
} from '../src/connectors/adapters/fixtures/mock-kyc.connector';
import { ConnectorExecutionResult } from '../src/connectors/ports/connector-execution.port';
import { WebhookOutboxStatus } from '../src/webhook/entity/webhook-outbox.entity';
import {
  BASE_WORKFLOW_AGREEMENT_KEY,
  BASE_WORKFLOW_AGREEMENT_TYPE,
  ensureAgreementPublished,
} from './agreements.support';
import { startE2eServer } from './e2e-server';

// Genuinely per-test configuration, captured so whatever `.env` had — including "unset" — is
// restored once this file is done, leaving nothing behind for a spec that runs after it in the
// same `--runInBand` process.
const ORIGINAL_ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ORIGINAL_MODE = process.env.MODE;
const ORIGINAL_KEY_RING_REFRESH_INTERVAL_MS = process.env.ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS;
const ORIGINAL_SWEEP_POLL_INTERVAL_MS = process.env.ENCRYPTION_SWEEP_POLL_INTERVAL_MS;
const ORIGINAL_KEY_ROTATION_CHECK_INTERVAL_MS =
  process.env.ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_MS;

// The key-encryption key this suite boots with. Deterministic and obviously test-only, rather than
// random per run: the sweep this suite exercises rewrites *every* onboarding row in the shared
// Compose database, so a run that dies mid-way leaves rows encrypted under whatever key it created.
// A random key would strand them — the next run could not unwrap that key and would refuse to boot
// — whereas this one lets the next run's `beforeAll` open them, turn encryption off, and decrypt
// them back. A key exported in the shell wins, for a database whose rows were wrapped under it.
const E2E_KEY_ENCRYPTION_KEY = createHash('sha256')
  .update('tsh-onboarding-conductor e2e key-encryption key')
  .digest('base64');
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? E2E_KEY_ENCRYPTION_KEY;
// `test/setup-e2e-env.cjs` sets `MODE=api-only` for every suite, and `stack:integration:up` (what
// `pnpm test:e2e` brings up) deliberately runs `engine` without `engine-worker` — so with no
// override here, nothing anywhere would ever run `EncryptionSweepService` and this scenario could
// never pass. `MODE=all` starts the sweep in this same in-process app that also serves the admin
// requests this suite makes. Set before the first import of `AppModule`, which reads it through
// `ConfigModule.forRoot()` at import time; `openApp` below still sets it per app, the way
// `webhook-outbox-queue.e2e-spec.ts` does, because the parking step opens an api-only app first.
process.env.MODE = AppMode.ALL;
// The two intervals the ring and the sweep read, at their documented minimums (`app.config.ts`):
// at the production defaults (15000ms, 5000ms) every step below is tens of seconds, not seconds.
process.env.ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS = '1000';
process.env.ENCRYPTION_SWEEP_POLL_INTERVAL_MS = '500';
// How often the engine asks whether the stored rotation schedule has come due, at its documented
// minimum: at the production default (60s) the scheduled-rotation scenario below would spend a
// minute waiting. The schedule it acts on is still a real one — 48h against a key this suite
// backdates — rather than an interval shortened past what the API offers.
process.env.ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_MS = '1000';

/** Long enough for several rotation checks to have run and found nothing to do. */
const ROTATION_CHECKS_WINDOW_MS = 4000;

/** What `GET /v1/admin/encryption` answers with, as far as this suite reads it. */
type EncryptionStateResponse = {
  enabled: boolean;
  keyConfigured: boolean;
  keys: Array<{
    id: string;
    deletedAt: string | null;
    active: boolean;
    pendingActivation: boolean;
  }>;
  rotation: { interval: string | null; nextRotationAt: string | null };
  progress: { pending: number; total: number };
};

/** How long any one background step may take before this suite calls it a failure. */
const SWEEP_TIMEOUT_MS = 60000;
const SWEEP_POLL_INTERVAL_MS = 500;
const TEST_TIMEOUT_MS = SWEEP_TIMEOUT_MS * 4;
const ENVELOPE_MARKER = '__tsh_enc';

/**
 * Proves the encryption feature end to end against the real Compose Postgres, through the admin
 * API an operator actually uses: turning encryption on encrypts every stored onboarding and every
 * new write; rotating moves every row onto the new key; turning it off decrypts every row back to
 * plain JSON — with every onboarding readable through the HTTP API at every step, `updated_at`
 * untouched by the sweep, and the whole story in the audit log. Nothing here mocks TypeORM or the
 * sweep's SQL: raw `SELECT`s read exactly what Postgres holds, so a regression in the transformer,
 * the claim predicates or the sweep's write path fails this spec rather than passing it.
 *
 * Also proves, against the live database rather than a simulation of its semantics, that
 * `uq_encryption_keys_active` really is enforced by Postgres.
 *
 * Every onboarding this spec writes is scoped to this run (a fresh uuid) and cleaned up in
 * `afterAll`. Because the sweep touches every row in the table, `afterAll` also turns encryption
 * back off and waits until no row is an envelope before emptying `encryption_keys` — a key row is
 * deleted only once no data can possibly still name it; if that wait fails, the keys are left in
 * place and the failure surfaced, never the other way round.
 *
 * Requires the local stack (`pnpm test:e2e` / `pnpm stack:integration:up`).
 */
describe('Data encryption (e2e)', () => {
  let app: NestExpressApplication | undefined;

  const createdOnboardingIds: string[] = [];

  const getApp = (): NestExpressApplication => {
    if (!app) {
      throw new Error('Test app not initialized');
    }

    return app;
  };

  const dataSource = (): DataSource => getApp().get(DataSource);
  const http = () => request(getApp().getHttpServer());

  const openApp = async (mode: AppMode): Promise<void> => {
    process.env.MODE = mode;

    const { AppModule } = await import('../src/app.module');
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    moduleFixture.get(ConfigService).set('MODE', mode);

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await startE2eServer(app);
  };

  const closeApp = async (): Promise<void> => {
    if (app) {
      await app.close();
      app = undefined;
    }
  };

  const waitUntil = async (condition: () => Promise<boolean>, what: string): Promise<void> => {
    const deadline = Date.now() + SWEEP_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (await condition()) {
        return;
      }

      await new Promise<void>((resolve) => setTimeout(resolve, SWEEP_POLL_INTERVAL_MS));
    }

    throw new Error(`Timed out after ${SWEEP_TIMEOUT_MS}ms waiting for ${what}`);
  };

  /** Bypasses every TypeORM transformer: raw SQL sees exactly what Postgres holds. */
  const readRawContext = async (onboardingId: string): Promise<Record<string, unknown>> => {
    const rows = await dataSource().query<Array<{ context: Record<string, unknown> }>>(
      'SELECT context FROM onboardings WHERE id = $1',
      [onboardingId],
    );
    expect(rows).toHaveLength(1);

    return rows[0].context;
  };

  const readRawUpdatedAt = async (onboardingId: string): Promise<string> => {
    const rows = await dataSource().query<Array<{ updated_at: Date }>>(
      'SELECT updated_at FROM onboardings WHERE id = $1',
      [onboardingId],
    );

    return new Date(rows[0].updated_at).toISOString();
  };

  const countEnvelopes = async (): Promise<number> => {
    const [row] = await dataSource().query<Array<{ count: string }>>(
      `SELECT count(*) FROM onboardings WHERE context ? '${ENVELOPE_MARKER}'`,
    );

    return Number(row.count);
  };

  const isEnvelope = (value: Record<string, unknown>): boolean => ENVELOPE_MARKER in value;

  const expectEnvelope = (value: Record<string, unknown>, keyId: string): void => {
    expect(Object.keys(value).sort()).toEqual([ENVELOPE_MARKER, 'd', 'k']);
    expect(value.k).toBe(keyId);
    expect(typeof value.d).toBe('string');
  };

  /** The key an operator's next change acts on: the one that has not been retired, if any. */
  const findTargetKeyId = (state: EncryptionStateResponse): string | null =>
    state.keys.find((key) => key.deletedAt === null)?.id ?? null;

  const readState = async (): Promise<EncryptionStateResponse> => {
    const response = await http().get('/v1/admin/encryption').expect(200);

    return response.body as EncryptionStateResponse;
  };

  /**
   * Turns encryption off and waits until the sweep has decrypted every row, so no row can still
   * name a key. Used by `afterAll` for cleanup and by `beforeAll` to recover from a run that died
   * with encryption on.
   */
  const turnOffAndDecryptEverything = async (): Promise<void> => {
    await http().patch('/v1/admin/encryption').send({ enabled: false }).expect(200);
    await waitUntil(async () => (await countEnvelopes()) === 0, 'every row to be decrypted');
  };

  beforeAll(async () => {
    // This suite runs the engine in a worker role, and the outbox worker polls the whole outbox
    // rather than the rows this suite created — see `.claude/rules/testing.md`. Park what earlier
    // suites left pending past the end of the run, through a plain api-only app, before the
    // worker-role app opens.
    await openApp(AppMode.API_ONLY);
    await dataSource().query(
      `UPDATE client_webhook_outbox
          SET next_delivery_at = NOW() + INTERVAL '1 day'
        WHERE status = $1
          AND next_delivery_at <= NOW()`,
      [WebhookOutboxStatus.PENDING],
    );
    await closeApp();

    await openApp(AppMode.ALL);

    // `base` links the `base-terms` family as pending on start; a family with nothing published
    // refuses the start entirely, so this is a prerequisite of the first `POST /v1/onboardings`.
    await ensureAgreementPublished(
      getApp(),
      BASE_WORKFLOW_AGREEMENT_KEY,
      BASE_WORKFLOW_AGREEMENT_TYPE,
    );

    // A previous run that died mid-way may have left encryption on; the deterministic KEK above
    // is what makes recovering from that possible here rather than by hand.
    if ((await readState()).enabled) {
      await turnOffAndDecryptEverything();
    }
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    let cleanupFailure: unknown;

    if (app) {
      try {
        await turnOffAndDecryptEverything();

        if (createdOnboardingIds.length > 0) {
          await dataSource().query('DELETE FROM onboardings WHERE id = ANY($1::uuid[])', [
            createdOnboardingIds,
          ]);
        }

        // Safe by construction, not by assumption: the wait above proved no row is an envelope,
        // so no key protects any data. Deleting a key that still did would make that data
        // unreadable forever, which is why this runs only after that wait and never on its failure.
        await dataSource().query('DELETE FROM encryption_keys');
      } catch (error) {
        cleanupFailure = error;
      } finally {
        await closeApp();
      }
    }

    for (const [name, original] of [
      ['ENCRYPTION_KEY', ORIGINAL_ENCRYPTION_KEY],
      ['MODE', ORIGINAL_MODE],
      ['ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS', ORIGINAL_KEY_RING_REFRESH_INTERVAL_MS],
      ['ENCRYPTION_SWEEP_POLL_INTERVAL_MS', ORIGINAL_SWEEP_POLL_INTERVAL_MS],
      ['ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_MS', ORIGINAL_KEY_ROTATION_CHECK_INTERVAL_MS],
    ] as const) {
      if (original === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = original;
      }
    }

    if (cleanupFailure !== undefined) {
      throw cleanupFailure;
    }
  }, TEST_TIMEOUT_MS);

  const startOnboarding = async (email: string): Promise<string> => {
    const startResponse = await http()
      .post('/v1/onboardings')
      .send({ workflowId: 'base' })
      .expect(201);
    const onboardingId = startResponse.body.onboardingId as string;
    createdOnboardingIds.push(onboardingId);

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ email })
      .expect((response) => expect([200, 201]).toContain(response.status));

    return onboardingId;
  };

  it('reports encryption off, no keys, and the key-encryption key configured, before anything is turned on', async () => {
    const state = await readState();

    expect(state.enabled).toBe(false);
    expect(state.keyConfigured).toBe(true);
    expect(state.keys).toEqual([]);
    expect(state.progress.pending).toBe(0);
  });

  it('refuses to rotate while encryption is off', async () => {
    await http()
      .post('/v1/admin/encryption/keys')
      .send({})
      .expect(409)
      .expect((response) => expect(response.body).toMatchObject({ code: 'ENCRYPTION_DISABLED' }));
  });

  it(
    'turns encryption on, encrypts stored and new onboardings, rotates them onto a new key, then turns off and decrypts every row — all readable throughout',
    async () => {
      const firstConnector = getApp().get(MockKyc1Connector);
      const secondConnector = getApp().get(MockKyc2Connector);
      // The fixture connectors always accept, but only after a 5s deliberate delay; mocking their
      // `execute` keeps this spec's own submits fast — the delays this test cannot avoid are the
      // grace windows and the sweep's, not the connectors'.
      jest.spyOn(firstConnector, 'execute').mockResolvedValue(ConnectorExecutionResult.accepted());
      const secondExecuteSpy = jest
        .spyOn(secondConnector, 'execute')
        .mockResolvedValue(ConnectorExecutionResult.accepted());

      // 1. A row written while encryption is off is plain JSON.
      const storedEmail = `encryption-e2e-stored-${randomUUID()}@example.com`;
      const storedId = await startOnboarding(storedEmail);
      expect(await readRawContext(storedId)).toEqual({ email: storedEmail });
      const storedUpdatedAtBefore = await readRawUpdatedAt(storedId);

      // 2. Turning encryption on creates a key that is not active yet, and reports every row as
      //    pending — including the one above and everything else already in the table.
      const enableResponse = await http()
        .patch('/v1/admin/encryption')
        .send({ enabled: true })
        .expect(200);
      expect(enableResponse.body.enabled).toBe(true);
      expect(enableResponse.body.keys).toHaveLength(1);
      const firstKeyId = enableResponse.body.keys[0].id as string;
      expect(enableResponse.body.keys[0]).toMatchObject({ active: false, pendingActivation: true });
      expect(enableResponse.body.progress.pending).toBeGreaterThanOrEqual(1);
      expect(enableResponse.body.progress.pending).toBe(enableResponse.body.progress.total);

      // Idempotent: asking again neither adds a key nor fails.
      const repeatResponse = await http()
        .patch('/v1/admin/encryption')
        .send({ enabled: true })
        .expect(200);
      expect(repeatResponse.body.keys).toHaveLength(1);

      // 3. The sweep encrypts the stored row onto the new key without touching updated_at, and only
      //    after the key has activated on this process (the grace window) plus its own delay.
      await waitUntil(async () => {
        const context = await readRawContext(storedId);
        return isEnvelope(context) && context.k === firstKeyId;
      }, 'the stored onboarding to be encrypted');
      expectEnvelope(await readRawContext(storedId), firstKeyId);
      expect(JSON.stringify(await readRawContext(storedId))).not.toContain(storedEmail);
      expect(await readRawUpdatedAt(storedId)).toBe(storedUpdatedAtBefore);
      await waitUntil(
        async () => (await readState()).progress.pending === 0,
        'the sweep to catch up',
      );
      expect((await readState()).keys[0]).toMatchObject({ active: true, pendingActivation: false });

      // 4. A row written now is encrypted on the way in.
      const freshEmail = `encryption-e2e-fresh-${randomUUID()}@example.com`;
      const freshId = await startOnboarding(freshEmail);
      expectEnvelope(await readRawContext(freshId), firstKeyId);

      // 5. Encrypted rows read back correctly through the API: a further submit makes
      //    `OnboardingsService` decrypt the stored row, merge the new field in, and hand the whole
      //    context to the next connector.
      await http()
        .post(`/v1/onboardings/${storedId}/submit`)
        .send({ acceptedTerms: true })
        .expect((response) => expect([200, 201]).toContain(response.status));
      expect(secondExecuteSpy).toHaveBeenCalledWith(
        expect.objectContaining({ context: { email: storedEmail, acceptedTerms: true } }),
      );

      // 6. Rotation: the new key is pending, the old one still active until the threshold, and
      //    the sweep then moves every row onto the new key.
      const rotateResponse = await http().post('/v1/admin/encryption/keys').send({}).expect(201);
      const secondKeyId = rotateResponse.body.id as string;
      expect(secondKeyId).not.toBe(firstKeyId);
      const afterRotation = await readState();
      expect(afterRotation.enabled).toBe(true);
      expect(afterRotation.keys.map((key) => key.id)).toEqual([secondKeyId, firstKeyId]);
      expect(afterRotation.keys[0]).toMatchObject({ active: false, pendingActivation: true });
      expect(afterRotation.keys[1]).toMatchObject({ active: true, pendingActivation: false });
      expect(afterRotation.keys[1].deletedAt).not.toBeNull();

      await waitUntil(async () => {
        const [stored, fresh] = await Promise.all([
          readRawContext(storedId),
          readRawContext(freshId),
        ]);
        return stored.k === secondKeyId && fresh.k === secondKeyId;
      }, 'both onboardings to move onto the rotated key');
      await waitUntil(
        async () => (await readState()).progress.pending === 0,
        'the rotation sweep to catch up',
      );

      // 7. Turning encryption off retires the key and reports every envelope as pending; the sweep
      //    then decrypts every row back to the plain JSON it started from.
      const disableResponse = await http()
        .patch('/v1/admin/encryption')
        .send({ enabled: false })
        .expect(200);
      expect(disableResponse.body.enabled).toBe(false);
      expect(
        disableResponse.body.keys.every(
          (key: { deletedAt: string | null }) => key.deletedAt !== null,
        ),
      ).toBe(true);
      expect(disableResponse.body.progress.pending).toBe(disableResponse.body.progress.total);

      await waitUntil(async () => (await countEnvelopes()) === 0, 'every row to be decrypted');
      expect(await readRawContext(storedId)).toEqual({ email: storedEmail, acceptedTerms: true });
      expect(await readRawContext(freshId)).toEqual({ email: freshEmail });
      expect((await readState()).progress.pending).toBe(0);

      // 8. Rotating is refused again now that encryption is off, and the retained keys still show.
      await http().post('/v1/admin/encryption/keys').send({}).expect(409);
      expect((await readState()).keys.map((key) => key.id)).toEqual([secondKeyId, firstKeyId]);

      // 9. The audit trail tells the whole story, filed against the keys it concerns. A sweep's
      //    `*_completed` row is written by the tick *after* the one that moved the last row — the
      //    tick that observes nothing pending — so it can land up to one poll interval after the
      //    data itself is in its final state; wait for it rather than asserting it at once.
      const readAuditActions = async (): Promise<Map<string, string[]>> => {
        const rows = await dataSource().query<Array<{ action: string; resource_id: string }>>(
          `SELECT action, resource_id FROM audit_log
            WHERE resource_type = 'encryption_key' AND resource_id = ANY($1::text[])
            ORDER BY occurred_at, id`,
          [[firstKeyId, secondKeyId]],
        );
        const byKey = new Map<string, string[]>([
          [firstKeyId, []],
          [secondKeyId, []],
        ]);

        for (const row of rows) {
          byKey.get(row.resource_id)?.push(row.action);
        }

        return byKey;
      };
      const expectedFirstKeyActions = [
        'encryption.enabled',
        'encryption.reencryption_started',
        'encryption.reencryption_completed',
        'encryption.key_superseded',
      ];
      const expectedSecondKeyActions = [
        'encryption.key_added',
        'encryption.reencryption_started',
        'encryption.reencryption_completed',
        'encryption.disabled',
        'encryption.decryption_started',
        'encryption.decryption_completed',
      ];
      const hasEvery = (actions: string[] | undefined, expected: string[]): boolean =>
        expected.every((action) => actions?.includes(action));

      await waitUntil(async () => {
        const actions = await readAuditActions();
        return (
          hasEvery(actions.get(firstKeyId), expectedFirstKeyActions) &&
          hasEvery(actions.get(secondKeyId), expectedSecondKeyActions)
        );
      }, 'the audit trail to record both sweeps as started and completed');

      const auditActions = await readAuditActions();
      expect(auditActions.get(firstKeyId)).toEqual(expect.arrayContaining(expectedFirstKeyActions));
      expect(auditActions.get(secondKeyId)).toEqual(
        expect.arrayContaining(expectedSecondKeyActions),
      );
      const everyAction = [...auditActions.values()].flat();
      expect(everyAction).not.toContain('encryption.reencryption_failed');
      expect(everyAction).not.toContain('encryption.decryption_failed');
    },
    TEST_TIMEOUT_MS,
  );

  it('rejects a second row naming deleted_at IS NULL with a unique violation, in Postgres itself', async () => {
    // Encryption is off by now (the test above turned it off), so a row of this suite's own is what
    // holds `deleted_at IS NULL` for the check. Its `activated_at` is an hour out, so the ring
    // treats it as pending rather than active, and `wrapped_key` never needs to be real material:
    // the unique index rejects the second `INSERT` before any value is read back out of the column.
    const [{ id: placeholderId }] = await dataSource().query<Array<{ id: string }>>(
      `INSERT INTO encryption_keys (id, wrapped_key, activated_at, deleted_at)
       VALUES (gen_random_uuid(), 'not-a-real-wrapped-key', now() + INTERVAL '1 hour', NULL)
       RETURNING id`,
    );

    try {
      await expect(
        dataSource().query(
          `INSERT INTO encryption_keys (id, wrapped_key, activated_at, deleted_at)
           VALUES (gen_random_uuid(), 'not-a-real-wrapped-key', now() + INTERVAL '1 hour', NULL)`,
        ),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'uq_encryption_keys_active',
      });
    } finally {
      await dataSource().query('DELETE FROM encryption_keys WHERE id = $1', [placeholderId]);
    }
  });

  it(
    'schedules rotation at a week when encryption is turned on, and rotates on its own once the chosen interval has elapsed',
    async () => {
      // 1. Turning encryption on schedules the default week — a key created now, due in a week.
      const enableResponse = await http()
        .patch('/v1/admin/encryption')
        .send({ enabled: true })
        .expect(200);
      // The key this test works with is the unretired one, never `keys[0]`: the history is ordered
      // by `created_at`, and step 3 below backdates this key's, which moves it to the end.
      const firstKeyId = findTargetKeyId(enableResponse.body as EncryptionStateResponse);
      expect(firstKeyId).not.toBeNull();
      expect(enableResponse.body.rotation.interval).toBe('1w');
      expect(Date.parse(enableResponse.body.rotation.nextRotationAt as string)).toBeGreaterThan(
        Date.now(),
      );

      // 2. The operator narrows it to 48 hours. Idempotent, and reported as the new next instant.
      const scheduleResponse = await http()
        .patch('/v1/admin/encryption/rotation')
        .send({ interval: '48h' })
        .expect(200);
      expect(scheduleResponse.body.rotation.interval).toBe('48h');
      await http().patch('/v1/admin/encryption/rotation').send({ interval: '48h' }).expect(200);

      // 3. Make that schedule due the only way a 48-hour one can be made due in a test: age the
      //    key itself, exactly as the passage of time would. The schedule is read from the row.
      await dataSource().query(
        `UPDATE encryption_keys SET created_at = now() - INTERVAL '3 days' WHERE id = $1`,
        [firstKeyId],
      );

      // 4. Nothing else is asked for: the engine's own scheduler rotates the key, and the new one
      //    carries the same schedule forward with its countdown restarted from its own creation.
      await waitUntil(async () => {
        const targetKeyId = findTargetKeyId(await readState());
        return targetKeyId !== null && targetKeyId !== firstKeyId;
      }, 'the engine to rotate the key on its schedule');

      const afterRotation = await readState();
      const rotatedKeyId = findTargetKeyId(afterRotation) as string;
      expect(rotatedKeyId).not.toBe(firstKeyId);
      expect(afterRotation.keys.find((key) => key.id === firstKeyId)?.deletedAt).not.toBeNull();
      expect(afterRotation.enabled).toBe(true);
      expect(afterRotation.rotation.interval).toBe('48h');
      expect(Date.parse(afterRotation.rotation.nextRotationAt as string)).toBeGreaterThan(
        Date.now(),
      );

      // 5. It rotates once, not once per check: the fresh key is not due, so later checks pass.
      await new Promise<void>((resolve) => setTimeout(resolve, ROTATION_CHECKS_WINDOW_MS));
      expect(findTargetKeyId(await readState())).toBe(rotatedKeyId);

      // 6. The trail records it as the engine's own work, and the operator's schedule change as
      //    theirs — both against the key each concerns.
      const auditRows = await dataSource().query<
        Array<{ action: string; actor_type: string; resource_id: string }>
      >(
        `SELECT action, actor_type, resource_id FROM audit_log
          WHERE resource_type = 'encryption_key' AND resource_id = ANY($1::text[])
          ORDER BY occurred_at, id`,
        [[firstKeyId, rotatedKeyId]],
      );

      expect(auditRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'encryption.rotation_schedule_changed',
            actor_type: 'operator',
            resource_id: firstKeyId,
          }),
          expect.objectContaining({
            action: 'encryption.key_added',
            actor_type: 'system',
            resource_id: rotatedKeyId,
          }),
          expect.objectContaining({
            action: 'encryption.key_superseded',
            actor_type: 'system',
            resource_id: firstKeyId,
          }),
        ]),
      );

      // 7. Leave the table as this suite found it: encryption off, every row plain JSON again —
      //    `afterAll` would do it anyway, but a later spec in the same file must not inherit an
      //    active key from this one.
      await turnOffAndDecryptEverything();
    },
    TEST_TIMEOUT_MS,
  );
});
