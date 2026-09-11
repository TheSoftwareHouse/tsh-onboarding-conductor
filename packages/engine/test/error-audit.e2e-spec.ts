import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';

jest.setTimeout(120000);

type AuditLogRow = {
  id: string;
  occurred_at: string;
  actor_type: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  metadata: Record<string, unknown>;
};

/**
 * `ConfigModule.forRoot()` runs once, when `AppModule`'s `@Module()` decorator is evaluated at
 * import time - not per `NestFactory.create()` call - so every app booted from this module in
 * this process shares one validated config snapshot. Auth is therefore enabled for the whole
 * suite; it only matters for scenario 4 below, since every other route this file drives is
 * public and never reaches `AzureJwtGuard`. No real Entra tenant is needed either - the denial
 * this suite exercises (a missing bearer token) is rejected before the verifier is ever called.
 */
const AUTH_TENANT_ID = '77777777-7777-7777-7777-777777777777';
const AUTH_AUDIENCE = '88888888-8888-8888-8888-888888888888';

/** `ApiFailureAuditFilter`'s `resourceId` format: `${method} ${matched route template}`. */
const DOCUMENTS_ROUTE_RESOURCE_ID = 'POST /v1/onboardings/:id/documents';
const SUBMIT_ROUTE_RESOURCE_ID = 'POST /v1/onboardings/:id/submit';
const CREATE_ROUTE_RESOURCE_ID = 'POST /v1/onboardings';
const LIST_ROUTE_RESOURCE_ID = 'GET /v1/onboardings';
/** `AzureJwtGuard`'s `admin_endpoint` resource id is the bare route path, no method prefix. */
const LIST_ADMIN_RESOURCE_ID = '/v1/onboardings';

/** Exactly what `ApiFailureAuditMetadata` may carry - see Proposed Solution S1 of the plan. */
const ALLOWED_API_FAILURE_METADATA_KEYS = [
  'method',
  'route',
  'status',
  'code',
  'errorName',
  'routeParams',
  'fieldErrors',
] as const;

let app: NestExpressApplication | null = null;

const createdOnboardingIds = new Set<string>();

const getApp = (): NestExpressApplication => {
  if (!app) {
    throw new Error('Test app not initialized');
  }

  return app;
};

const dataSource = (): DataSource => getApp().get(DataSource);

const readAuditRows = async (
  resourceType: string,
  resourceId: string,
  since: Date,
): Promise<AuditLogRow[]> =>
  dataSource().query(
    `SELECT id, occurred_at, actor_type, actor_id, action, resource_type, resource_id, metadata
     FROM audit_log
     WHERE resource_type = $1 AND resource_id = $2 AND occurred_at >= $3
     ORDER BY occurred_at DESC, id DESC`,
    [resourceType, resourceId, since],
  );

const readApiFailureAuditRows = async (since: Date): Promise<AuditLogRow[]> =>
  dataSource().query(
    `SELECT id, occurred_at, actor_type, actor_id, action, resource_type, resource_id, metadata
     FROM audit_log
     WHERE action LIKE 'api.%' AND occurred_at >= $1
     ORDER BY occurred_at DESC, id DESC`,
    [since],
  );

/**
 * Every row this feature writes is best-effort and fire-and-forget - the filter and the guard
 * both schedule their writes and return the response immediately. A bare read straight after the
 * HTTP call races that write, so every assertion on a new row polls instead.
 */
const waitForAuditRow = async (
  readRows: () => Promise<AuditLogRow[]>,
  predicate: (row: AuditLogRow) => boolean = () => true,
  options: { attempts?: number; intervalMs?: number } = {},
): Promise<AuditLogRow | undefined> => {
  const attempts = options.attempts ?? 40;
  const intervalMs = options.intervalMs ?? 25;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const rows = await readRows();
    const row = rows.find(predicate);

    if (row) {
      return row;
    }

    if (attempt < attempts - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  return undefined;
};

const cleanupCreatedRows = async (suiteStartedAt: Date): Promise<void> => {
  if (!app) {
    return;
  }

  const onboardingIds = Array.from(createdOnboardingIds);

  if (onboardingIds.length > 0) {
    await dataSource().query(
      'DELETE FROM audit_log WHERE resource_type = $1 AND resource_id = ANY($2::text[])',
      ['onboarding', onboardingIds],
    );
  }

  // The `api.*` and `auth.*` rows are filed under a shared route template rather than a
  // per-test id, so cleanup is scoped to the window this suite ran in instead.
  await dataSource().query(
    `DELETE FROM audit_log WHERE (action LIKE 'api.%' OR action LIKE 'auth.%') AND occurred_at >= $1`,
    [suiteStartedAt],
  );

  createdOnboardingIds.clear();
};

describe('Error audit logs (e2e)', () => {
  let suiteStartedAt: Date;

  beforeAll(async () => {
    suiteStartedAt = new Date();
    // Postgres timestamps and the JS clock can land on the same millisecond; step back so the
    // window reliably includes rows written immediately after.
    suiteStartedAt.setMilliseconds(suiteStartedAt.getMilliseconds() - 1);

    process.env.ADMIN_AUTH_ENABLED = 'true';
    process.env.AZURE_TENANT_ID = AUTH_TENANT_ID;
    process.env.AZURE_API_AUDIENCE = AUTH_AUDIENCE;
    process.env.ADMIN_REQUIRED_ROLES = 'admin';

    const { createApp } = await import('../src/main');

    const bundle = await createApp();
    app = bundle.app;
    await app.init();
  });

  afterAll(async () => {
    await cleanupCreatedRows(suiteStartedAt);
    await app?.close();
  });

  it('writes exactly one api.request_rejected row for a 404 with no domain audit, filed under the route template', async () => {
    const onboardingId = randomUUID();
    const since = new Date();
    since.setMilliseconds(since.getMilliseconds() - 1);

    const response = await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${onboardingId}/documents`)
      .send({ field: 'passport', contentType: 'image/png', sizeBytes: 1024 })
      .expect(404);

    expect(response.body).toEqual({
      code: 'DOCUMENT_UPLOAD_NOT_FOUND',
      message: 'DOCUMENT_UPLOAD_NOT_FOUND',
    });

    const row = await waitForAuditRow(() =>
      readAuditRows('api_endpoint', DOCUMENTS_ROUTE_RESOURCE_ID, since),
    );

    expect(row).toEqual(
      expect.objectContaining({
        actor_type: 'anonymous',
        actor_id: 'unknown',
        action: 'api.request_rejected',
        resource_type: 'api_endpoint',
        resource_id: DOCUMENTS_ROUTE_RESOURCE_ID,
        metadata: {
          method: 'POST',
          route: '/v1/onboardings/:id/documents',
          status: 404,
          code: 'DOCUMENT_UPLOAD_NOT_FOUND',
          errorName: 'DocumentUploadNotFoundException',
          routeParams: { id: onboardingId },
        },
      }),
    );

    // Never the raw concrete id: the row is filed under the route template, never the id that
    // never existed - only `routeParams` carries the concrete value.
    expect(row!.resource_id).not.toContain(onboardingId);

    const allRowsInWindow = await readAuditRows('api_endpoint', DOCUMENTS_ROUTE_RESOURCE_ID, since);
    expect(allRowsInWindow).toHaveLength(1);

    // No domain audit exists anywhere for this onboarding id - `DocumentUploadService` never
    // touches `AuditService`, so the filter's row is the only trace of this rejection.
    const domainRows = await readAuditRows('onboarding', onboardingId, since);
    expect(domainRows).toHaveLength(0);
  });

  it('records ValidationPipe constraint keys and leaves the 400 response body unchanged', async () => {
    const since = new Date();
    since.setMilliseconds(since.getMilliseconds() - 1);

    const response = await request(getApp().getHttpServer())
      .post('/v1/onboardings')
      .send({ workflowId: '' })
      .expect(400);

    // The hard constraint this feature must not break: Nest's default `ValidationPipe` body,
    // byte-identical, with no rendered sentence smuggled into the audit-facing fields.
    expect(response.body).toEqual({
      message: ['workflowId should not be empty'],
      error: 'Bad Request',
      statusCode: 400,
    });

    const row = await waitForAuditRow(() =>
      readAuditRows('api_endpoint', CREATE_ROUTE_RESOURCE_ID, since),
    );

    expect(row).toEqual(
      expect.objectContaining({
        actor_type: 'anonymous',
        actor_id: 'unknown',
        action: 'api.request_rejected',
        resource_type: 'api_endpoint',
        resource_id: CREATE_ROUTE_RESOURCE_ID,
        metadata: {
          method: 'POST',
          route: '/v1/onboardings',
          status: 400,
          code: null,
          errorName: 'ValidationFailedException',
          fieldErrors: { workflowId: ['isNotEmpty'] },
        },
      }),
    );

    // The constraint key only - never class-validator's rendered message, which can echo
    // submitted or allowed values.
    const serializedFieldErrors = JSON.stringify(row!.metadata.fieldErrors);
    expect(serializedFieldErrors).not.toContain('should not be empty');
  });

  it('suppresses the api.* duplicate: a rejected submit yields exactly one row for the event', async () => {
    const onboardingId = randomUUID();
    const since = new Date();
    since.setMilliseconds(since.getMilliseconds() - 1);

    const beforeCount = (
      await readAuditRows('api_endpoint', SUBMIT_ROUTE_RESOURCE_ID, suiteStartedAt)
    ).length;

    const response = await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({})
      .expect(404);

    expect(response.body).toEqual({
      code: 'ONBOARDING_NOT_FOUND',
      message: 'ONBOARDING_NOT_FOUND',
    });

    createdOnboardingIds.add(onboardingId);

    const rejectedRow = await waitForAuditRow(
      () => readAuditRows('onboarding', onboardingId, since),
      (candidate) => candidate.action === 'onboarding.rejected_attempt',
    );

    expect(rejectedRow).toEqual(
      expect.objectContaining({
        actor_type: 'system',
        actor_id: 'engine',
        action: 'onboarding.rejected_attempt',
        resource_type: 'onboarding',
        resource_id: onboardingId,
        metadata: { operation: 'submit', outcome: 'onboarding_not_found' },
      }),
    );

    // Exactly one row for the event: the domain row exists once, and there is no `api.*`
    // duplicate for it - the throw site is marked `markAuditRecorded`, so the filter's
    // `isAuditRecorded` check skips scheduling a write for it entirely.
    const domainRows = await readAuditRows('onboarding', onboardingId, since);
    expect(domainRows).toHaveLength(1);

    const afterCount = (
      await readAuditRows('api_endpoint', SUBMIT_ROUTE_RESOURCE_ID, suiteStartedAt)
    ).length;
    expect(afterCount).toBe(beforeCount);
  });

  it('records exactly one auth.* row and exactly one api.request_rejected row for an unauthenticated admin read', async () => {
    const since = new Date();
    since.setMilliseconds(since.getMilliseconds() - 1);

    const beforeApiCount = (
      await readAuditRows('api_endpoint', LIST_ROUTE_RESOURCE_ID, suiteStartedAt)
    ).length;

    await request(getApp().getHttpServer()).get('/v1/onboardings').expect(401);

    const authRow = await waitForAuditRow(() =>
      readAuditRows('admin_endpoint', LIST_ADMIN_RESOURCE_ID, since),
    );

    expect(authRow).toEqual(
      expect.objectContaining({
        actor_type: 'anonymous',
        actor_id: 'unknown',
        action: 'auth.token_rejected',
        resource_type: 'admin_endpoint',
        resource_id: LIST_ADMIN_RESOURCE_ID,
        metadata: { method: 'GET', reason: 'Missing bearer access token' },
      }),
    );

    const authRowsInWindow = await readAuditRows('admin_endpoint', LIST_ADMIN_RESOURCE_ID, since);
    expect(authRowsInWindow).toHaveLength(1);

    // The guard's denial throw is deliberately left unmarked (see `azure-jwt.guard.ts`), so the
    // filter also schedules its own `api.request_rejected` row for the same 401 - a guaranteed
    // duplicate, chosen deliberately over the risk of a failed `auth.*` write leaving zero
    // evidence behind.
    const apiRow = await waitForAuditRow(() =>
      readAuditRows('api_endpoint', LIST_ROUTE_RESOURCE_ID, since),
    );

    expect(apiRow).toEqual(
      expect.objectContaining({
        actor_type: 'anonymous',
        actor_id: 'unknown',
        action: 'api.request_rejected',
        resource_type: 'api_endpoint',
        resource_id: LIST_ROUTE_RESOURCE_ID,
        metadata: {
          method: 'GET',
          route: '/v1/onboardings',
          status: 401,
          code: null,
          errorName: 'UnauthorizedException',
        },
      }),
    );

    const afterApiCount = (
      await readAuditRows('api_endpoint', LIST_ROUTE_RESOURCE_ID, suiteStartedAt)
    ).length;
    expect(afterApiCount).toBe(beforeApiCount + 1);
  });

  it('never records an exception message, and only the seven contracted metadata keys appear', async () => {
    const apiFailureRows = await readApiFailureAuditRows(suiteStartedAt);

    // Sanity check that this assertion is exercising real rows - scenarios 1 and 2 above wrote
    // at least two, so an empty result here would mean the query itself is wrong, not that the
    // feature is clean.
    expect(apiFailureRows.length).toBeGreaterThanOrEqual(2);

    const observedKeys = new Set<string>();

    for (const row of apiFailureRows) {
      const metadataKeys = Object.keys(row.metadata);

      for (const key of metadataKeys) {
        observedKeys.add(key);
      }

      expect(metadataKeys).not.toContain('message');
      expect(metadataKeys).not.toContain('errorMessage');
      expect(metadataKeys).not.toContain('stack');
      expect(metadataKeys).not.toContain('body');
    }

    for (const key of observedKeys) {
      expect(ALLOWED_API_FAILURE_METADATA_KEYS).toContain(key);
    }
  });
});
