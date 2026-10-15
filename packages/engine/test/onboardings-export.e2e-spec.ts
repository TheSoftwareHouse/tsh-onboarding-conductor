import { createHash, randomUUID } from 'node:crypto';
import nodeHttp from 'node:http';
import type { AddressInfo } from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  BASE_WORKFLOW_AGREEMENT_KEY,
  BASE_WORKFLOW_AGREEMENT_TYPE,
  ensureAgreementPublished,
} from './agreements.support';
import { startE2eServer } from './e2e-server';
import { OnboardingsRepository } from '../src/onboardings/onboardings.repository';
import { WorkflowRegistryService } from '../src/workflows/workflow-registry.service';

// Same deterministic key-encryption key as `encryption.e2e-spec.ts`, so a key this suite leaves
// behind after a crash is one the next run (or the preflight) can unwrap.
const ORIGINAL_ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ORIGINAL_KEY_RING_REFRESH_INTERVAL_MS = process.env.ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS;
const ORIGINAL_ADMIN_AUTH_ENABLED = process.env.ADMIN_AUTH_ENABLED;
const E2E_KEY_ENCRYPTION_KEY = createHash('sha256')
  .update('tsh-onboarding-conductor e2e key-encryption key')
  .digest('base64');
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? E2E_KEY_ENCRYPTION_KEY;
process.env.ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS = '1000';
process.env.ADMIN_AUTH_ENABLED = 'false';

const BOM_CODE_POINT = 0xfeff;
const ENVELOPE_MARKER = '__tsh_enc';
const WAIT_TIMEOUT_MS = 30000;
const WAIT_POLL_INTERVAL_MS = 250;
const TEST_TIMEOUT_MS = 120000;
const SETTLE_MS = 1500;
const SLOW_BATCH_MS = 300;
const EXPORT_ROUTE = '/v1/onboardings/export';

const BATCH_BOUNDARY_ROWS = 5120;
const SCORING_WORKFLOW_ID = 'scoring';
const BASE_WORKFLOW_ID = 'base';
const FIXED_COLUMNS = [
  'Onboarding id',
  'Workflow id',
  'Workflow version',
  'Status',
  'Current step',
  'Agreement status',
  'Rejection reason',
  'Created at',
  'Updated at',
  'Completed at',
];
const SPECIAL_FIRST_NAME = 'Ada, "the" first\nsecond line';
const SPECIAL_LAST_NAME = '=SUM(1+1)';

type ListBody = {
  items: Array<{ onboardingId: string }>;
  meta: { pagination: { total: number; totalPages: number } };
};

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF records. */
const parseCsv = (text: string): string[][] => {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\r' && text[index + 1] === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      index += 1;
    } else {
      field += char;
    }
  }

  return records;
};

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

describe('GET /v1/onboardings/export (e2e)', () => {
  let app: NestExpressApplication | undefined;
  const seededIds: string[] = [];
  const startedIds: string[] = [];
  let specialRowId = '';

  const getApp = (): NestExpressApplication => {
    if (!app) {
      throw new Error('Test app not initialized');
    }

    return app;
  };
  const dataSource = (): DataSource => getApp().get(DataSource);
  const http = () => request(getApp().getHttpServer());

  const waitUntil = async (condition: () => Promise<boolean>, what: string): Promise<void> => {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (await condition()) {
        return;
      }

      await sleep(WAIT_POLL_INTERVAL_MS);
    }

    throw new Error(`Timed out after ${WAIT_TIMEOUT_MS}ms waiting for ${what}`);
  };

  const exportCsv = (query: Record<string, string> = {}) =>
    http()
      .get('/v1/onboardings/export')
      .query(query)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

  /** The body without its BOM, parsed into records. */
  const readCsv = (body: Buffer): { header: string[]; rows: string[][] } => {
    const text = body.toString('utf8');
    const [header, ...rows] = parseCsv(
      text.charCodeAt(0) === BOM_CODE_POINT ? text.slice(1) : text,
    );

    return { header, rows };
  };

  const listAllIds = async (query: Record<string, string>): Promise<string[]> => {
    const first = await http()
      .get('/v1/onboardings')
      .query({ ...query, limit: '100' })
      .expect(200);
    const firstBody = first.body as ListBody;
    const ids = firstBody.items.map((item) => item.onboardingId);

    for (let page = 2; page <= firstBody.meta.pagination.totalPages; page += 1) {
      const next = await http()
        .get('/v1/onboardings')
        .query({ ...query, limit: '100', page: String(page) })
        .expect(200);
      ids.push(...(next.body as ListBody).items.map((item) => item.onboardingId));
    }

    return ids;
  };

  const countExportAuditRows = async (): Promise<number> => {
    const [row] = await dataSource().query<Array<{ count: string }>>(
      `SELECT count(*) FROM audit_log WHERE action = 'onboardings.exported'`,
    );

    return Number(row.count);
  };

  const countFailureRows = async (): Promise<number> => {
    const [row] = await dataSource().query<Array<{ count: string }>>(
      `SELECT count(*) FROM audit_log
        WHERE action = 'api.request_failed' AND metadata->>'route' = $1`,
      [EXPORT_ROUTE],
    );

    return Number(row.count);
  };

  const countEnvelopes = async (): Promise<number> => {
    const [row] = await dataSource().query<Array<{ count: string }>>(
      `SELECT count(*) FROM onboardings WHERE context ? '${ENVELOPE_MARKER}'`,
    );

    return Number(row.count);
  };

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module');
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await startE2eServer(app);
    await ensureAgreementPublished(
      getApp(),
      BASE_WORKFLOW_AGREEMENT_KEY,
      BASE_WORKFLOW_AGREEMENT_TYPE,
    );

    // Created-at values differ by single microseconds and tie in threes, so a cursor that went
    // through a JS `Date` (millisecond precision) would skip or repeat rows at the 5000 boundary.
    const bulk = await dataSource().query<Array<{ id: string }>>(
      `INSERT INTO onboardings (id, workflow_version_id, status, current_step, context, scores, created_at, updated_at, completed_at)
       SELECT gen_random_uuid(),
              (SELECT wv.workflow_version_id FROM workflow_versions wv
                 JOIN workflows w ON w.workflow_id = wv.workflow_id
                WHERE w.key = $1 AND wv.version = 1),
              CASE WHEN n % 2 = 0 THEN 'approved' ELSE 'awaiting_user' END,
              CASE WHEN n % 2 = 1 THEN 'collect_profile' END,
              jsonb_build_object('firstName', 'First ' || n, 'lastName', 'Last', 'connectorNote', 'extra'),
              jsonb_build_object('risk', 42, 'trust', 7),
              TIMESTAMPTZ '2031-03-04 05:06:07+00' + (n / 3) * INTERVAL '1 microsecond',
              TIMESTAMPTZ '2031-03-04 05:06:07+00',
              CASE WHEN n % 2 = 0 THEN TIMESTAMPTZ '2031-03-04 05:06:07+00' END
         FROM generate_series(1, $2) AS n
       RETURNING id`,
      [SCORING_WORKFLOW_ID, BATCH_BOUNDARY_ROWS],
    );
    seededIds.push(...bulk.map((row) => row.id));

    specialRowId = randomUUID();
    await dataSource().query(
      `INSERT INTO onboardings (id, workflow_version_id, status, current_step, context, scores, created_at, updated_at)
       VALUES ($1,
               (SELECT wv.workflow_version_id FROM workflow_versions wv
                  JOIN workflows w ON w.workflow_id = wv.workflow_id
                 WHERE w.key = $2 AND wv.version = 1),
               'awaiting_user', 'collect_profile', $3::jsonb, $4::jsonb,
               TIMESTAMPTZ '2031-03-04 05:06:08+00', TIMESTAMPTZ '2031-03-04 05:06:08+00')`,
      [
        specialRowId,
        SCORING_WORKFLOW_ID,
        JSON.stringify({
          firstName: SPECIAL_FIRST_NAME,
          lastName: SPECIAL_LAST_NAME,
          connectorNote: 'extra',
        }),
        JSON.stringify({ risk: 90, trust: 1 }),
      ],
    );
    seededIds.push(specialRowId);

    // A second workflow, so the header is a union across more than one workflow version.
    await dataSource().query(
      `INSERT INTO onboardings (id, workflow_version_id, status, current_step, context, created_at, updated_at)
       VALUES ($1,
               (SELECT wv.workflow_version_id FROM workflow_versions wv
                  JOIN workflows w ON w.workflow_id = wv.workflow_id
                 WHERE w.key = $2 AND wv.version = 1),
               'awaiting_user', 'accept_terms', $3::jsonb,
               TIMESTAMPTZ '2031-03-04 05:06:09+00', TIMESTAMPTZ '2031-03-04 05:06:09+00')`,
      [randomUUID(), BASE_WORKFLOW_ID, JSON.stringify({ email: 'plain@example.com' })],
    );
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    let cleanupFailure: unknown;

    if (app) {
      try {
        // Turn encryption off for good measure, then delete only what this suite wrote. Keys are
        // cleared only once no row is an envelope: a key still named by data is never deleted.
        await http().patch('/v1/admin/encryption').send({ enabled: false });
        const ownIds = [...seededIds, ...startedIds];

        await dataSource().query(
          `DELETE FROM onboardings
            WHERE id = ANY($1::uuid[])
               OR context->>'email' = 'plain@example.com'`,
          [ownIds],
        );

        if ((await countEnvelopes()) === 0) {
          await dataSource().query('DELETE FROM encryption_keys');
        } else {
          throw new Error('Encrypted rows remain, so encryption_keys was left in place.');
        }
      } catch (error) {
        cleanupFailure = error;
      } finally {
        await app.close();
        app = undefined;
      }
    }

    for (const [name, original] of [
      ['ENCRYPTION_KEY', ORIGINAL_ENCRYPTION_KEY],
      ['ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS', ORIGINAL_KEY_RING_REFRESH_INTERVAL_MS],
      ['ADMIN_AUTH_ENABLED', ORIGINAL_ADMIN_AUTH_ENABLED],
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

  it('streams a CSV with the BOM, the download headers and the declared columns', async () => {
    const response = await exportCsv({ workflowId: SCORING_WORKFLOW_ID }).expect(200);

    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="onboardings-\d{8}T\d{6}Z\.csv"$/,
    );
    expect(response.headers['cache-control']).toBe('no-store');

    const body = response.body as Buffer;
    expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(body.toString('utf8').includes('\r\n')).toBe(true);

    const { header } = readCsv(body);
    expect(header.slice(0, FIXED_COLUMNS.length)).toEqual(FIXED_COLUMNS);
    expect(header.slice(FIXED_COLUMNS.length, FIXED_COLUMNS.length + 2)).toEqual([
      'Risk score',
      'Trust score',
    ]);
    expect(header).toEqual(expect.arrayContaining(['First name', 'Last name']));
    expect(header[header.length - 1]).toBe('Other data');
  });

  it('lists the same onboardings in the same order as the list, across a batch boundary', async () => {
    const query = { workflowId: SCORING_WORKFLOW_ID };
    const { header, rows } = readCsv((await exportCsv(query).expect(200)).body as Buffer);
    const exportedIds = rows.map((row) => row[header.indexOf('Onboarding id')]);
    const listedIds = await listAllIds(query);

    expect(exportedIds.length).toBeGreaterThan(5000);
    expect(new Set(exportedIds).size).toBe(exportedIds.length);
    expect(exportedIds).toEqual(listedIds);

    const [sqlCount] = await dataSource().query<Array<{ count: string }>>(
      `SELECT count(*) FROM onboardings o
         JOIN workflow_versions wv ON wv.workflow_version_id = o.workflow_version_id
         JOIN workflows w ON w.workflow_id = wv.workflow_id
        WHERE w.key = $1`,
      [SCORING_WORKFLOW_ID],
    );
    expect(exportedIds).toHaveLength(Number(sqlCount.count));
  });

  it('matches the list total for an unfiltered export spanning more than one workflow', async () => {
    const { header, rows } = readCsv((await exportCsv().expect(200)).body as Buffer);
    const total = (
      (await http().get('/v1/onboardings').query({ limit: '1' }).expect(200)).body as ListBody
    ).meta.pagination.total;
    const workflows = new Set(rows.map((row) => row[header.indexOf('Workflow id')]));

    expect(rows).toHaveLength(total);
    expect(workflows.has(SCORING_WORKFLOW_ID)).toBe(true);
    expect(workflows.has(BASE_WORKFLOW_ID)).toBe(true);
    expect(header).toEqual(expect.arrayContaining(['Email', 'First name']));
  });

  it('round-trips awkward values, neutralises formulas and puts undeclared keys in Other data', async () => {
    const { header, rows } = readCsv(
      (await exportCsv({ workflowId: SCORING_WORKFLOW_ID }).expect(200)).body as Buffer,
    );
    const cell = (row: string[], column: string): string => row[header.indexOf(column)];
    const special = rows.find((row) => cell(row, 'Onboarding id') === specialRowId);

    expect(special).toBeDefined();
    expect(cell(special!, 'First name')).toBe(SPECIAL_FIRST_NAME);
    expect(cell(special!, 'Last name')).toBe(`'${SPECIAL_LAST_NAME}`);
    expect(cell(special!, 'Risk score')).toBe('90');
    expect(cell(special!, 'Trust score')).toBe('1');
    expect(JSON.parse(cell(special!, 'Other data'))).toEqual({ connectorNote: 'extra' });
    expect(cell(special!, 'Workflow version')).toBe('1');
    expect(cell(special!, 'Created at')).toBe('2031-03-04T05:06:08.000Z');
    expect(cell(special!, 'Completed at')).toBe('');

    const baseRows = readCsv((await exportCsv({ workflowId: BASE_WORKFLOW_ID }).expect(200)).body);
    const plain = baseRows.rows.find(
      (row) => row[baseRows.header.indexOf('Email')] === 'plain@example.com',
    );
    expect(plain).toBeDefined();
    expect(plain![baseRows.header.indexOf('Other data')]).toBe('');
  });

  it('derives agreement status in every batch, and filters on it', async () => {
    const [latest] = await dataSource().query<Array<{ agreement_version_id: string }>>(
      `SELECT av.agreement_version_id FROM agreement_versions av
         JOIN agreements a ON a.id = av.agreement_id
        WHERE a.key = $1
        ORDER BY av.version DESC
        LIMIT 1`,
      [BASE_WORKFLOW_AGREEMENT_KEY],
    );
    // The special row is the newest scoring row (first batch); seededIds[0] the oldest (second batch).
    const acceptedIds = [specialRowId, seededIds[0]];
    const pendingId = seededIds[1];

    await dataSource().query(
      `INSERT INTO onboarding_agreements (onboarding_id, agreement_version_id, status, accepted_at)
       SELECT id, $2, 'accepted', now() FROM unnest($1::uuid[]) AS id`,
      [acceptedIds, latest.agreement_version_id],
    );
    await dataSource().query(
      `INSERT INTO onboarding_agreements (onboarding_id, agreement_version_id, status)
       VALUES ($1, $2, 'pending')`,
      [pendingId, latest.agreement_version_id],
    );

    const query = { workflowId: SCORING_WORKFLOW_ID };
    const all = readCsv((await exportCsv(query).expect(200)).body as Buffer);
    const statusById = new Map(
      all.rows.map((row) => [
        row[all.header.indexOf('Onboarding id')],
        row[all.header.indexOf('Agreement status')],
      ]),
    );

    expect(statusById.get(specialRowId)).toBe('current');
    expect(statusById.get(seededIds[0])).toBe('current');
    expect(statusById.get(pendingId)).toBe('not_accepted');
    expect(statusById.get(seededIds[2])).toBe('not_accepted');

    const filtered = readCsv(
      (await exportCsv({ ...query, agreementStatus: 'current' }).expect(200)).body as Buffer,
    );

    expect(
      filtered.rows.map((row) => row[filtered.header.indexOf('Onboarding id')]).sort(),
    ).toEqual([...acceptedIds].sort());
  });

  it('narrows by status and workflow', async () => {
    const query = { workflowId: SCORING_WORKFLOW_ID, status: 'approved' };
    const { header, rows } = readCsv((await exportCsv(query).expect(200)).body as Buffer);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row[header.indexOf('Status')] === 'approved')).toBe(true);
    expect(rows.every((row) => row[header.indexOf('Workflow id')] === SCORING_WORKFLOW_ID)).toBe(
      true,
    );
    expect(rows.map((row) => row[header.indexOf('Onboarding id')])).toEqual(
      await listAllIds(query),
    );
  });

  it('returns only the header when nothing matches', async () => {
    const response = await exportCsv({ onboardingId: randomUUID() }).expect(200);
    const { header, rows } = readCsv(response.body as Buffer);

    expect(header.slice(0, FIXED_COLUMNS.length)).toEqual(FIXED_COLUMNS);
    expect(rows).toHaveLength(0);
  });

  it('rejects a non-numeric workflowVersion with 400 and writes no audit row', async () => {
    const before = await countExportAuditRows();

    await http()
      .get('/v1/onboardings/export')
      .query({ workflowVersion: 'abc' })
      .expect(400)
      .expect((response) =>
        expect(response.body.message).toContain('workflowVersion must be an integer number'),
      );

    expect(await countExportAuditRows()).toBe(before);
  });

  it('writes one onboardings.exported audit row per export, carrying the filters', async () => {
    const before = await countExportAuditRows();

    await exportCsv({ workflowId: BASE_WORKFLOW_ID, status: 'awaiting_user' }).expect(200);

    expect(await countExportAuditRows()).toBe(before + 1);

    const [latest] = await dataSource().query<
      Array<{
        actor_type: string;
        resource_type: string;
        metadata: Record<string, unknown>;
      }>
    >(
      `SELECT actor_type, resource_type, metadata FROM audit_log
        WHERE action = 'onboardings.exported' ORDER BY occurred_at DESC LIMIT 1`,
    );
    expect(latest).toMatchObject({
      actor_type: 'operator',
      resource_type: 'onboardings_export',
      metadata: { workflowId: BASE_WORKFLOW_ID, status: 'awaiting_user' },
    });
  });

  it('answers 500, audits api.request_failed and writes no export row when the columns fail to resolve', async () => {
    const exportRowsBefore = await countExportAuditRows();
    const failuresBefore = await countFailureRows();

    jest
      .spyOn(getApp().get(WorkflowRegistryService), 'getDefinitionForAdmin')
      .mockRejectedValue(new Error('registry exploded'));

    await exportCsv({ workflowId: SCORING_WORKFLOW_ID }).expect(500);
    await waitUntil(
      async () => (await countFailureRows()) === failuresBefore + 1,
      'the failure audit row',
    );

    expect(await countExportAuditRows()).toBe(exportRowsBefore);

    const [latest] = await dataSource().query<Array<{ metadata: Record<string, unknown> }>>(
      `SELECT metadata FROM audit_log
        WHERE action = 'api.request_failed' AND metadata->>'route' = $1
        ORDER BY occurred_at DESC LIMIT 1`,
      [EXPORT_ROUTE],
    );
    expect(latest.metadata).toMatchObject({ status: 500, errorName: 'Error' });
  });

  it('aborts the connection and audits api.request_failed when a batch read fails after the first byte', async () => {
    const exportRowsBefore = await countExportAuditRows();
    const failuresBefore = await countFailureRows();

    // The delay lets the header chunk reach the client, so the failure lands after the first byte.
    jest
      .spyOn(getApp().get(OnboardingsRepository), 'findAdminExportBatch')
      .mockImplementation(async () => {
        await sleep(SLOW_BATCH_MS);
        throw new Error('batch read exploded');
      });

    await expect(exportCsv({ workflowId: SCORING_WORKFLOW_ID })).rejects.toThrow();
    await waitUntil(
      async () => (await countFailureRows()) === failuresBefore + 1,
      'the failure audit row',
    );

    expect(await countExportAuditRows()).toBe(exportRowsBefore + 1);
    await sleep(SETTLE_MS);
    expect(await countFailureRows()).toBe(failuresBefore + 1);
  });

  it('stops reading batches and writes no failure row when the client disconnects mid-export', async () => {
    const failuresBefore = await countFailureRows();
    const repository = getApp().get(OnboardingsRepository);
    const readBatch = jest.spyOn(repository, 'findAdminExportBatch');
    const { port } = getApp().getHttpServer().address() as AddressInfo;

    await new Promise<void>((resolve, reject) => {
      const clientRequest = nodeHttp.get(
        { host: '127.0.0.1', port, path: `${EXPORT_ROUTE}?workflowId=${SCORING_WORKFLOW_ID}` },
        (response) => {
          response.once('data', () => {
            clientRequest.destroy();
            resolve();
          });
        },
      );
      clientRequest.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ECONNRESET') {
          reject(error);
        }
      });
    });

    await sleep(SETTLE_MS);
    const callsAfterDisconnect = readBatch.mock.calls.length;
    await sleep(SETTLE_MS);

    expect(readBatch.mock.calls.length).toBe(callsAfterDisconnect);
    expect(callsAfterDisconnect).toBeLessThan(2);
    expect(await countFailureRows()).toBe(failuresBefore);
  });

  it(
    'exports decrypted values while encryption is on',
    async () => {
      await http().patch('/v1/admin/encryption').send({ enabled: true }).expect(200);
      await waitUntil(async () => {
        const state = (await http().get('/v1/admin/encryption')).body as {
          keys: Array<{ active: boolean }>;
        };

        return state.keys.some((key) => key.active);
      }, 'the encryption key to activate');

      const email = `export-e2e-${randomUUID()}@example.com`;
      const startResponse = await http()
        .post('/v1/onboardings')
        .send({ workflowId: BASE_WORKFLOW_ID })
        .expect(201);
      const onboardingId = startResponse.body.onboardingId as string;
      startedIds.push(onboardingId);
      await http()
        .post(`/v1/onboardings/${onboardingId}/submit`)
        .send({ email })
        .expect((response) => expect([200, 201]).toContain(response.status));

      const [stored] = await dataSource().query<Array<{ context: Record<string, unknown> }>>(
        'SELECT context FROM onboardings WHERE id = $1',
        [onboardingId],
      );
      expect(ENVELOPE_MARKER in stored.context).toBe(true);
      expect(JSON.stringify(stored.context)).not.toContain(email);

      const { header, rows } = readCsv(
        (await exportCsv({ onboardingId }).expect(200)).body as Buffer,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0][header.indexOf('Email')]).toBe(email);
    },
    TEST_TIMEOUT_MS,
  );
});
