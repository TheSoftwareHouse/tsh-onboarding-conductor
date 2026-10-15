import 'reflect-metadata';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import { exceptionFactory } from '../src/validation/validation-exception.factory';
import { startE2eServer } from './e2e-server';

const TENANT_ID = '99999999-9999-9999-9999-999999999999';
const AUDIENCE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const KEY_ID = 'admin-workflow-drafts-signing-key';
const OPERATOR_OID = '9f3c0000-0000-0000-0000-0000000000ee';

const FAMILY_PREFIX = 'drafts-e2e-';
const DRAFT_ID = `${FAMILY_PREFIX}flow`;
const RENAMED_ID = `${FAMILY_PREFIX}renamed`;
const PUBLISHED_ID = `${FAMILY_PREFIX}published`;
const UNKNOWN_ID = `${FAMILY_PREFIX}unknown`;
const COLLIDING_ID = `${FAMILY_PREFIX}colliding`;
const BUILT_IN_ID = 'eu-b2c-individual-kyc-eea';
const FIXTURES_ID = 'base';
const ONE_DRAFT_INDEX = 'uq_workflow_versions_one_draft';
/** One past the `integer` column's range. */
const OUT_OF_RANGE_VERSION = 2_147_483_648;
const MISSING_ONBOARDING_STEP = 'collect_email';

const NOT_FOUND = { code: 'WORKFLOW_NOT_FOUND', message: 'WORKFLOW_NOT_FOUND' };

/** Parses as JSON and saves, but is no workflow: the compile route would refuse it. */
const invalidDraft = (id: string, version: number, name?: string) => ({
  id,
  version,
  ...(name === undefined ? {} : { name }),
  steps: [{ name: 'lonely', type: 'not-a-step-type' }],
});

const validDocument = (id: string, version: number, name: string) => ({
  id,
  version,
  name,
  initial: 'collect_email',
  steps: [
    {
      name: 'collect_email',
      type: 'form',
      config: {
        fields: { email: { type: 'text', required: true, validation: { format: 'email' } } },
      },
      edges: { success: 'approved' },
    },
    { name: 'approved', type: 'terminal', config: { outcome: 'approved' } },
  ],
});

describe('Admin workflow drafts (e2e)', () => {
  let app: NestExpressApplication | undefined;
  let dataSource: DataSource;
  let usersDir: string;
  let privateKey: KeyLike;
  let getKey: ReturnType<typeof createLocalJWKSet>;
  let token: string;

  const startApp = async (): Promise<void> => {
    const { AppModule } = await import('../src/app.module');
    const { ADMIN_TOKEN_VERIFIER } = await import('../src/auth/admin-token-verifier.port');
    const { AzureTokenVerifier } = await import('../src/auth/azure-token-verifier');
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ADMIN_TOKEN_VERIFIER)
      .useValue(new AzureTokenVerifier({ tenantId: TENANT_ID, audience: AUDIENCE, getKey }))
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>(undefined, {
      bodyParser: false,
    });
    app.useBodyParser('json', { strict: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, exceptionFactory }));
    await startE2eServer(app);
    dataSource = app.get(DataSource);
  };

  const stopApp = async (): Promise<void> => {
    await app?.close();
    app = undefined;
  };

  const http = () => request(app!.getHttpServer());
  const authed = (req: request.Test): request.Test => req.set('Authorization', `Bearer ${token}`);
  const post = (body: unknown) => authed(http().post('/v1/admin/workflows')).send(body as object);
  const put = (id: string, version: number | string, body: unknown) =>
    authed(http().put(`/v1/admin/workflows/${id}/versions/${version}`)).send(body as object);
  const del = (id: string, version: number | string) =>
    authed(http().delete(`/v1/admin/workflows/${id}/versions/${version}`));
  const getDocument = (id: string, version: number | string) =>
    authed(http().get(`/v1/admin/workflows/${id}/versions/${version}/document`));
  const getVersion = (id: string, version: number | string) =>
    authed(http().get(`/v1/admin/workflows/${id}/versions/${version}`));

  const findRows = (id: string) =>
    dataSource.query<
      Array<{
        workflow_version_id: string;
        version: number;
        status: string;
        definition: Record<string, unknown>;
        updated_at: Date;
        scope: string;
        name: string | null;
      }>
    >(
      `SELECT wv.workflow_version_id, wv.version, wv.status, wv.definition, wv.updated_at,
              w.scope, w.name
         FROM workflow_versions wv
         JOIN workflows w ON w.workflow_id = wv.workflow_id
        WHERE w.key = $1
        ORDER BY wv.version ASC`,
      [id],
    );

  const findFamilies = (id: string) =>
    dataSource.query<Array<{ name: string | null }>>('SELECT name FROM workflows WHERE key = $1', [
      id,
    ]);

  const findAuditRows = (workflowVersionId: string) =>
    dataSource.query<
      Array<{ action: string; actor_id: string; entry_type: string; metadata: unknown }>
    >(
      `SELECT action, actor_id, entry_type, metadata
         FROM audit_log
        WHERE resource_type = 'workflow_version' AND resource_id = $1
        ORDER BY occurred_at ASC, id ASC`,
      [workflowVersionId],
    );

  /** Onboardings first (`ON DELETE RESTRICT`), then the audit rows of the drafts, then the families. */
  const purgeFamilies = async (): Promise<void> => {
    await dataSource.query(
      `DELETE FROM onboardings o
        USING workflow_versions wv, workflows w
        WHERE o.workflow_version_id = wv.workflow_version_id
          AND wv.workflow_id = w.workflow_id
          AND w.key LIKE $1`,
      [`${FAMILY_PREFIX}%`],
    );
    await dataSource.query(
      `DELETE FROM audit_log
        WHERE resource_type = 'workflow_version'
          AND action LIKE 'workflow_draft.%'
          AND metadata->>'workflowId' LIKE $1`,
      [`${FAMILY_PREFIX}%`],
    );
    await dataSource.query('DELETE FROM workflows WHERE key LIKE $1', [`${FAMILY_PREFIX}%`]);
  };

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256', { extractable: true });
    privateKey = keyPair.privateKey;
    const publicJwk = await exportJWK(keyPair.publicKey);
    getKey = createLocalJWKSet({
      keys: [{ ...publicJwk, kid: KEY_ID, alg: 'RS256', use: 'sig' }],
    });

    usersDir = mkdtempSync(path.join(tmpdir(), 'engine-workflow-drafts-'));
    writeFileSync(
      path.join(usersDir, 'published.workflow.json'),
      JSON.stringify(validDocument(PUBLISHED_ID, 1, 'Drafts E2E published')),
    );

    process.env.ADMIN_AUTH_ENABLED = 'true';
    process.env.AZURE_TENANT_ID = TENANT_ID;
    process.env.AZURE_API_AUDIENCE = AUDIENCE;
    process.env.ADMIN_REQUIRED_ROLES = 'admin';
    process.env.ADMIN_PANEL_ORIGIN = 'http://localhost:5173';
    process.env.CLIENT_WEBHOOK_BASE_URL = '';
    process.env.WORKFLOWS_USERS_DIR = usersDir;

    await startApp();
    await purgeFamilies();
    await stopApp();
    await startApp();

    const { buildEntraIssuer } = await import('../src/auth/azure-token-verifier');
    token = await new SignJWT({
      scp: 'Onboardings.Read',
      oid: OPERATOR_OID,
      preferred_username: 'workflow.drafts@tsh.io',
      tid: TENANT_ID,
      roles: ['admin'],
    })
      .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
      .setSubject('operator-subject')
      .setIssuer(buildEntraIssuer(TENANT_ID))
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('30m')
      .sign(privateKey);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await purgeFamilies();
    }

    await stopApp();
    rmSync(usersDir, { recursive: true, force: true });
    delete process.env.WORKFLOWS_USERS_DIR;
  });

  it('answers 401 without a token on every route', async () => {
    const base = `/v1/admin/workflows/${DRAFT_ID}/versions/1`;

    await http().post('/v1/admin/workflows').send(invalidDraft(DRAFT_ID, 1)).expect(401);
    await http().get(base).expect(401);
    await http().get(`${base}/document`).expect(401);
    await http().put(base).send(invalidDraft(DRAFT_ID, 1)).expect(401);
    await http().delete(base).expect(401);
  });

  describe('the draft lifecycle', () => {
    let draftVersionId: string;

    it('creates a draft in a new users family, labelled with the document name', async () => {
      const response = await post(invalidDraft(DRAFT_ID, 1, 'Drafts E2E flow')).expect(201);

      expect(response.body).toEqual({
        workflowId: DRAFT_ID,
        version: 1,
        status: 'draft',
        name: 'Drafts E2E flow',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      const rows = await findRows(DRAFT_ID);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'draft', scope: 'users', name: 'Drafts E2E flow' });
      draftVersionId = rows[0].workflow_version_id;
    });

    it('reads the document back verbatim', async () => {
      const response = await getDocument(DRAFT_ID, 1).expect(200);

      expect(response.body).toEqual({
        workflowId: DRAFT_ID,
        version: 1,
        status: 'draft',
        name: 'Drafts E2E flow',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        document: invalidDraft(DRAFT_ID, 1, 'Drafts E2E flow'),
      });
    });

    it('lists the draft among the versions and answers 400 for its invalid compiled view', async () => {
      const versions = await authed(http().get(`/v1/admin/workflows/${DRAFT_ID}/versions`)).expect(
        200,
      );
      expect(versions.body.items).toEqual([
        {
          version: 1,
          status: 'draft',
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      ]);

      const response = await getVersion(DRAFT_ID, 1).expect(400);
      expect(response.body).toMatchObject({ code: 'WORKFLOW_INVALID' });
    });

    it('keeps the compile dry run working for another document while an invalid draft is stored', async () => {
      const response = await authed(http().post('/v1/admin/workflows/compile'))
        .send(validDocument(`${FAMILY_PREFIX}dry-run`, 1, 'Dry run'))
        .expect(200);

      expect(response.body.workflow).toMatchObject({
        workflowId: `${FAMILY_PREFIX}dry-run`,
        workflowVersion: 1,
      });
    });

    it('updates the content in place and leaves the family label alone', async () => {
      const response = await put(DRAFT_ID, 1, invalidDraft(DRAFT_ID, 1, 'Changed label')).expect(
        200,
      );

      expect(response.body).toMatchObject({
        workflowId: DRAFT_ID,
        version: 1,
        status: 'draft',
        name: 'Drafts E2E flow',
      });

      const document = await getDocument(DRAFT_ID, 1).expect(200);
      expect(document.body.document).toEqual(invalidDraft(DRAFT_ID, 1, 'Changed label'));
    });

    it('serves a valid draft as a compiled definition', async () => {
      await put(DRAFT_ID, 1, validDocument(DRAFT_ID, 1, 'Drafts E2E flow')).expect(200);

      const response = await getVersion(DRAFT_ID, 1).expect(200);
      expect(response.body).toMatchObject({ workflowId: DRAFT_ID, workflowVersion: 1 });
    });

    it('renames the id and version, creating the target family and deleting the emptied one', async () => {
      const response = await put(DRAFT_ID, 1, invalidDraft(RENAMED_ID, 3, 'Renamed family')).expect(
        200,
      );

      expect(response.body).toMatchObject({
        workflowId: RENAMED_ID,
        version: 3,
        status: 'draft',
        name: 'Renamed family',
      });
      expect(await findFamilies(DRAFT_ID)).toEqual([]);

      const rows = await findRows(RENAMED_ID);
      expect(rows).toHaveLength(1);
      expect(rows[0].workflow_version_id).toBe(draftVersionId);
      expect(rows[0]).toMatchObject({ version: 3, scope: 'users', name: 'Renamed family' });

      await getDocument(DRAFT_ID, 1).expect(404).expect(NOT_FOUND);
      await getDocument(RENAMED_ID, 3).expect(200);
    });

    it('answers 409 for each conflicting write', async () => {
      const secondDraft = await post(invalidDraft(RENAMED_ID, 4)).expect(409);
      expect(secondDraft.body).toEqual({
        code: 'WORKFLOW_DRAFT_EXISTS',
        message: 'WORKFLOW_DRAFT_EXISTS',
        workflowId: RENAMED_ID,
        draftVersion: 3,
      });

      const existing = await post(invalidDraft(PUBLISHED_ID, 1)).expect(409);
      expect(existing.body).toEqual({
        code: 'WORKFLOW_VERSION_EXISTS',
        message: 'WORKFLOW_VERSION_EXISTS',
        workflowId: PUBLISHED_ID,
        version: 1,
      });

      const builtIn = await post(invalidDraft(BUILT_IN_ID, 9)).expect(409);
      expect(builtIn.body).toEqual({
        code: 'WORKFLOW_SCOPE_CONFLICT',
        message: 'WORKFLOW_SCOPE_CONFLICT',
        workflowId: BUILT_IN_ID,
        scope: 'built-in',
      });

      await post(invalidDraft(FIXTURES_ID, 9))
        .expect(409)
        .expect((response) => {
          expect(response.body).toMatchObject({
            code: 'WORKFLOW_SCOPE_CONFLICT',
            scope: 'fixtures',
          });
        });

      await put(RENAMED_ID, 3, invalidDraft(PUBLISHED_ID, 1))
        .expect(409)
        .expect((response) => {
          expect(response.body).toMatchObject({ code: 'WORKFLOW_VERSION_EXISTS' });
        });
      await put(RENAMED_ID, 3, invalidDraft(BUILT_IN_ID, 9))
        .expect(409)
        .expect((response) => {
          expect(response.body).toMatchObject({ code: 'WORKFLOW_SCOPE_CONFLICT' });
        });

      const [row] = await findRows(RENAMED_ID);
      expect(row).toMatchObject({ version: 3, status: 'draft' });
    });

    it('refuses a document that cannot name a draft, without storing anything', async () => {
      await post([]).expect(400);
      await post({ version: 1 })
        .expect(400)
        .expect((response) => {
          expect(response.body).toMatchObject({ code: 'WORKFLOW_INVALID', path: 'id' });
        });
      await post({ id: `${FAMILY_PREFIX}bad-version`, version: 0 })
        .expect(400)
        .expect((response) => {
          expect(response.body).toMatchObject({ code: 'WORKFLOW_INVALID', path: 'version' });
        });
      await post({ id: 'x'.repeat(101), version: 1 }).expect(400);
      await post({ id: `${FAMILY_PREFIX}bad-version`, version: OUT_OF_RANGE_VERSION })
        .expect(400)
        .expect((response) => {
          expect(response.body).toMatchObject({ code: 'WORKFLOW_INVALID', path: 'version' });
        });

      expect(await findFamilies(`${FAMILY_PREFIX}bad-version`)).toEqual([]);
    });

    it('answers 404 for a version nobody stored and 400 for a malformed version', async () => {
      await getDocument(UNKNOWN_ID, 1).expect(404).expect(NOT_FOUND);
      await getDocument(RENAMED_ID, 7).expect(404).expect(NOT_FOUND);
      await put(RENAMED_ID, 7, invalidDraft(RENAMED_ID, 7)).expect(404).expect(NOT_FOUND);
      await del(RENAMED_ID, 7).expect(404).expect(NOT_FOUND);

      await getDocument(RENAMED_ID, 0).expect(400);
      await getVersion(RENAMED_ID, 'abc').expect(400);
      await put(RENAMED_ID, 0, invalidDraft(RENAMED_ID, 3)).expect(400);
      await del(RENAMED_ID, 0).expect(400);
      await getVersion(RENAMED_ID, OUT_OF_RANGE_VERSION).expect(400);
      await getDocument(RENAMED_ID, OUT_OF_RANGE_VERSION).expect(400);
    });

    it('answers 409 WORKFLOW_VERSION_NOT_DRAFT on a published version and changes nothing', async () => {
      const before = await findRows(PUBLISHED_ID);
      expect(before).toHaveLength(1);
      expect(before[0].status).toBe('published');

      const expected = {
        code: 'WORKFLOW_VERSION_NOT_DRAFT',
        message: 'WORKFLOW_VERSION_NOT_DRAFT',
        workflowId: PUBLISHED_ID,
        version: 1,
        status: 'published',
      };

      await put(PUBLISHED_ID, 1, invalidDraft(PUBLISHED_ID, 1)).expect(409).expect(expected);
      await del(PUBLISHED_ID, 1).expect(409).expect(expected);

      expect(await findRows(PUBLISHED_ID)).toEqual(before);
      await getVersion(PUBLISHED_ID, 1).expect(200);
    });

    it('serves the stored document of a published version', async () => {
      const [row] = await findRows(PUBLISHED_ID);

      const response = await getDocument(PUBLISHED_ID, 1).expect(200);

      expect(response.body).toMatchObject({
        workflowId: PUBLISHED_ID,
        version: 1,
        status: 'published',
      });
      expect(response.body.document).toEqual(row.definition);
    });

    it('serves the stored document of a retired version', async () => {
      const [row] = await findRows(PUBLISHED_ID);
      await dataSource.query(
        `UPDATE workflow_versions SET status = 'retired' WHERE workflow_version_id = $1`,
        [row.workflow_version_id],
      );

      try {
        const response = await getDocument(PUBLISHED_ID, 1).expect(200);

        expect(response.body).toMatchObject({ version: 1, status: 'retired' });
        expect(response.body.document).toEqual(row.definition);
      } finally {
        await dataSource.query(
          `UPDATE workflow_versions SET status = $2 WHERE workflow_version_id = $1`,
          [row.workflow_version_id, row.status],
        );
      }
    });

    it('answers 404 for a version of a published family that was never stored', async () => {
      await getDocument(PUBLISHED_ID, 7).expect(404).expect(NOT_FOUND);
    });

    it('refuses a second draft inserted by SQL at the partial index', async () => {
      await expect(
        dataSource.query(
          `INSERT INTO workflow_versions
             (workflow_version_id, workflow_id, version, status, definition)
           SELECT gen_random_uuid(), workflow_id, 99, 'draft', '{}'::jsonb
             FROM workflows WHERE key = $1`,
          [RENAMED_ID],
        ),
      ).rejects.toMatchObject({ constraint: ONE_DRAFT_INDEX });
    });

    it('refuses to replace or delete a draft an onboarding references', async () => {
      await dataSource.query(
        `INSERT INTO onboardings (id, workflow_version_id, status, current_step)
         VALUES (gen_random_uuid(), $1, 'awaiting_user', $2)`,
        [draftVersionId, MISSING_ONBOARDING_STEP],
      );

      try {
        const expected = {
          code: 'WORKFLOW_DRAFT_IN_USE',
          message: 'WORKFLOW_DRAFT_IN_USE',
          workflowId: RENAMED_ID,
          version: 3,
        };

        await put(RENAMED_ID, 3, invalidDraft(RENAMED_ID, 3, 'In use'))
          .expect(409)
          .expect(expected);
        await del(RENAMED_ID, 3).expect(409).expect(expected);
        expect(await findRows(RENAMED_ID)).toHaveLength(1);
      } finally {
        await dataSource.query('DELETE FROM onboardings WHERE workflow_version_id = $1', [
          draftVersionId,
        ]);
      }
    });

    it('deletes the draft and its emptied family', async () => {
      await del(RENAMED_ID, 3).expect(204);

      expect(await findFamilies(RENAMED_ID)).toEqual([]);
      await getDocument(RENAMED_ID, 3).expect(404).expect(NOT_FOUND);
    });

    it('audits every write with identifiers only, never the document', async () => {
      const rows = await findAuditRows(draftVersionId);

      expect(rows.map((row) => row.action)).toEqual([
        'workflow_draft.created',
        'workflow_draft.updated',
        'workflow_draft.updated',
        'workflow_draft.updated',
        'workflow_draft.deleted',
      ]);
      expect(rows.every((row) => row.entry_type === 'success')).toBe(true);
      expect(rows[0].metadata).toEqual({ workflowId: DRAFT_ID, version: 1 });
      expect(rows[3].metadata).toEqual({
        workflowId: RENAMED_ID,
        version: 3,
        previousWorkflowId: DRAFT_ID,
        previousVersion: 1,
      });
      expect(rows[4].metadata).toEqual({ workflowId: RENAMED_ID, version: 3 });

      const serialized = JSON.stringify(rows);
      expect(serialized).not.toContain('steps');
      expect(serialized).not.toContain('not-a-step-type');
      expect(rows[0].actor_id).toEqual(expect.stringContaining(OPERATOR_OID));
    });
  });

  describe('a users file that collides with a stored draft', () => {
    it('lets the engine boot, leaves the draft unchanged and publishes nothing', async () => {
      await post(invalidDraft(COLLIDING_ID, 1, 'Colliding draft')).expect(201);
      const [before] = await findRows(COLLIDING_ID);

      const filePath = path.join(usersDir, 'colliding.workflow.json');
      writeFileSync(filePath, JSON.stringify(validDocument(COLLIDING_ID, 1, 'Colliding file')));

      await stopApp();
      try {
        await startApp();
      } finally {
        rmSync(filePath, { force: true });
      }

      const rows = await findRows(COLLIDING_ID);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        workflow_version_id: before.workflow_version_id,
        status: 'draft',
        name: 'Colliding draft',
        definition: invalidDraft(COLLIDING_ID, 1, 'Colliding draft'),
      });
      expect(rows[0].updated_at).toEqual(before.updated_at);
    });
  });
});
