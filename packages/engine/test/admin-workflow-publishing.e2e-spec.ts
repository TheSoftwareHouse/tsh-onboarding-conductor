import 'reflect-metadata';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import { FIXTURE_WORKFLOWS_DIR } from '../src/workflows/workflow-roots';
import { exceptionFactory } from '../src/validation/validation-exception.factory';
import { startE2eServer } from './e2e-server';

const TENANT_ID = '99999999-9999-9999-9999-999999999999';
const AUDIENCE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const KEY_ID = 'admin-workflow-publishing-signing-key';
const OPERATOR_OID = '9f3c0000-0000-0000-0000-0000000000ef';

const FAMILY_PREFIX = 'publishing-e2e-';
const FLOW_ID = `${FAMILY_PREFIX}flow`;
const LATEST_ID = `${FAMILY_PREFIX}latest`;
const INVALID_ID = `${FAMILY_PREFIX}invalid`;
const CONFLICT_ID = `${FAMILY_PREFIX}conflict`;
const SHADOWED_ID = `${FAMILY_PREFIX}shadowed`;
const UNKNOWN_ID = `${FAMILY_PREFIX}unknown`;
const RACE_A_ID = `${FAMILY_PREFIX}race-a`;
const RACE_B_ID = `${FAMILY_PREFIX}race-b`;
const RACE_SOURCE_KEY = 'publishing_e2e_race_source_key';
/** The fixture family whose connector `sourceKey` the conflicting draft repeats. */
const SOURCE_KEY_OWNER_ID = 'scoring';
const OWNED_SOURCE_KEY = 'sumsub_kyc_scoring_individual_standard_v2';

const NOT_FOUND = { code: 'WORKFLOW_NOT_FOUND', message: 'WORKFLOW_NOT_FOUND' };

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

/** Parses as JSON and saves, but is no workflow: publishing must refuse it. */
const invalidDocument = (id: string, version: number) => ({
  id,
  version,
  steps: [{ name: 'lonely', type: 'not-a-step-type' }],
});

/** The fixture's own document under a new id, so it declares a `sourceKey` another family owns. */
const sourceKeyConflictDocument = (id: string, version: number) => ({
  ...JSON.parse(readFileSync(path.join(FIXTURE_WORKFLOWS_DIR, 'scoring.workflow.json'), 'utf8')),
  id,
  version,
  name: 'Publishing E2E conflict',
});

/** The fixture's document under a new id and a sourceKey no published family owns. */
const raceDocument = (id: string) => {
  const document = sourceKeyConflictDocument(id, 1);
  return JSON.parse(JSON.stringify(document).replace(OWNED_SOURCE_KEY, RACE_SOURCE_KEY));
};

describe('Admin workflow publishing (e2e)', () => {
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
  const createDraft = (body: unknown) =>
    authed(http().post('/v1/admin/workflows')).send(body as object);
  const publishUrl = (id: string, version: number | string) =>
    `/v1/admin/workflows/${id}/versions/${version}/publish`;
  const publish = (id: string, version: number | string) =>
    authed(http().post(publishUrl(id, version)));

  const findRows = (id: string) =>
    dataSource.query<
      Array<{
        workflow_version_id: string;
        version: number;
        status: string;
        updated_at: Date;
        name: string | null;
      }>
    >(
      `SELECT wv.workflow_version_id, wv.version, wv.status, wv.updated_at, w.name
         FROM workflow_versions wv
         JOIN workflows w ON w.workflow_id = wv.workflow_id
        WHERE w.key = $1
        ORDER BY wv.version ASC`,
      [id],
    );

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

  /** Onboardings first (`ON DELETE RESTRICT`), then the audit rows, then the families. */
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

  const writeUsersFile = (fileName: string, document: object): void => {
    writeFileSync(path.join(usersDir, fileName), JSON.stringify(document));
  };

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256', { extractable: true });
    privateKey = keyPair.privateKey;
    const publicJwk = await exportJWK(keyPair.publicKey);
    getKey = createLocalJWKSet({
      keys: [{ ...publicJwk, kid: KEY_ID, alg: 'RS256', use: 'sig' }],
    });

    usersDir = mkdtempSync(path.join(tmpdir(), 'engine-workflow-publishing-'));
    writeUsersFile('flow.workflow.json', validDocument(FLOW_ID, 1, 'Publishing E2E file'));
    writeUsersFile('latest.workflow.json', validDocument(LATEST_ID, 3, 'Publishing E2E latest'));

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
      preferred_username: 'workflow.publishing@tsh.io',
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

  it('answers 401 without a token', async () => {
    await http().post(publishUrl(FLOW_ID, 1)).expect(401);
  });

  describe('publishing a valid draft', () => {
    let draftVersionId: string;
    let fileRowBefore: Awaited<ReturnType<typeof findRows>>[number];

    it('flips the draft to published, leaves the other versions alone and returns the publication', async () => {
      await createDraft(validDocument(FLOW_ID, 2, 'Publishing E2E v2')).expect(201);
      const [fileRow, draftRow] = await findRows(FLOW_ID);
      expect(draftRow.status).toBe('draft');
      fileRowBefore = fileRow;
      draftVersionId = draftRow.workflow_version_id;

      const response = await publish(FLOW_ID, 2).expect(200);

      expect(response.body).toEqual({
        workflowId: FLOW_ID,
        version: 2,
        status: 'published',
        name: 'Publishing E2E v2',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      const rows = await findRows(FLOW_ID);
      expect(rows.map(({ version, status }) => ({ version, status }))).toEqual([
        { version: 1, status: 'published' },
        { version: 2, status: 'published' },
      ]);
      expect({ ...rows[0], name: null }).toEqual({ ...fileRowBefore, name: null });
      expect(rows[1].updated_at.getTime()).toBeGreaterThan(draftRow.updated_at.getTime());
    });

    it('relabels the family with the root name of the published document', async () => {
      expect(fileRowBefore.name).toBe('Publishing E2E file');

      const [row] = await findRows(FLOW_ID);
      expect(row.name).toBe('Publishing E2E v2');
    });

    it('audits the publish with identifiers only', async () => {
      const rows = await findAuditRows(draftVersionId);

      expect(rows.map((row) => row.action)).toEqual([
        'workflow_draft.created',
        'workflow_draft.published',
      ]);
      expect(rows[1]).toMatchObject({
        entry_type: 'success',
        metadata: { workflowId: FLOW_ID, version: 2 },
      });
      expect(rows[1].metadata).toEqual({ workflowId: FLOW_ID, version: 2 });
      expect(rows[1].actor_id).toEqual(expect.stringContaining(OPERATOR_OID));
      expect(JSON.stringify(rows[1])).not.toContain('steps');
    });

    it('starts an unpinned onboarding on the published version', async () => {
      const response = await http()
        .post('/v1/onboardings')
        .send({ workflowId: FLOW_ID })
        .expect(201);

      const rows = await dataSource.query(
        `SELECT wv.version
           FROM onboardings o
           JOIN workflow_versions wv ON wv.workflow_version_id = o.workflow_version_id
          WHERE o.id = $1`,
        [response.body.onboardingId],
      );

      expect(rows).toEqual([{ version: 2 }]);
    });

    it('answers 409 WORKFLOW_VERSION_NOT_DRAFT when the version is published again', async () => {
      const response = await publish(FLOW_ID, 2).expect(409);

      expect(response.body).toEqual({
        code: 'WORKFLOW_VERSION_NOT_DRAFT',
        message: 'WORKFLOW_VERSION_NOT_DRAFT',
        workflowId: FLOW_ID,
        version: 2,
        status: 'published',
      });
    });

    it('boots again with the published row compiled', async () => {
      const before = await findRows(FLOW_ID);

      await stopApp();
      await startApp();

      expect(await findRows(FLOW_ID)).toEqual(before);
      await authed(http().get(`/v1/admin/workflows/${FLOW_ID}/versions/2`)).expect(200);
    });
  });

  describe('refusals', () => {
    it('answers 409 WORKFLOW_VERSION_NOT_LATEST for a draft below a published file version', async () => {
      await createDraft(validDocument(LATEST_ID, 2, 'Publishing E2E below')).expect(201);

      const response = await publish(LATEST_ID, 2).expect(409);

      expect(response.body).toEqual({
        code: 'WORKFLOW_VERSION_NOT_LATEST',
        message: 'WORKFLOW_VERSION_NOT_LATEST',
        workflowId: LATEST_ID,
        version: 2,
        latestPublishedVersion: 3,
      });
      const rows = await findRows(LATEST_ID);
      expect(rows.map(({ version, status }) => ({ version, status }))).toEqual([
        { version: 2, status: 'draft' },
        { version: 3, status: 'published' },
      ]);
    });

    it('answers 409 WORKFLOW_VERSION_EXISTS for a draft a workflow file shadows and keeps it a draft', async () => {
      await createDraft(validDocument(SHADOWED_ID, 1, 'Publishing E2E shadowed draft')).expect(201);
      writeUsersFile(
        'shadowed.workflow.json',
        validDocument(SHADOWED_ID, 1, 'Publishing E2E file'),
      );

      try {
        const response = await publish(SHADOWED_ID, 1).expect(409);

        expect(response.body).toEqual({
          code: 'WORKFLOW_VERSION_EXISTS',
          message: 'WORKFLOW_VERSION_EXISTS',
          workflowId: SHADOWED_ID,
          version: 1,
        });
        expect(await findRows(SHADOWED_ID)).toMatchObject([{ version: 1, status: 'draft' }]);
      } finally {
        rmSync(path.join(usersDir, 'shadowed.workflow.json'));
      }
    });

    it('answers 400 WORKFLOW_INVALID for a draft that does not compile and keeps it a draft', async () => {
      await createDraft(invalidDocument(INVALID_ID, 1)).expect(201);

      const response = await publish(INVALID_ID, 1).expect(400);

      expect(response.body).toMatchObject({ code: 'WORKFLOW_INVALID' });
      expect(await findRows(INVALID_ID)).toMatchObject([{ version: 1, status: 'draft' }]);
    });

    it('answers 409 WORKFLOW_SOURCE_KEY_CONFLICT for a sourceKey another family owns and keeps it a draft', async () => {
      await createDraft(sourceKeyConflictDocument(CONFLICT_ID, 1)).expect(201);

      const response = await publish(CONFLICT_ID, 1).expect(409);

      expect(response.body).toMatchObject({
        code: 'WORKFLOW_SOURCE_KEY_CONFLICT',
        sourceKey: OWNED_SOURCE_KEY,
        conflictingWorkflowId: SOURCE_KEY_OWNER_ID,
      });
      expect(await findRows(CONFLICT_ID)).toMatchObject([{ version: 1, status: 'draft' }]);
    });

    it('lets exactly one of two concurrent publishes claim a shared sourceKey', async () => {
      await createDraft(raceDocument(RACE_A_ID)).expect(201);
      await createDraft(raceDocument(RACE_B_ID)).expect(201);

      const responses = await Promise.all([publish(RACE_A_ID, 1), publish(RACE_B_ID, 1)]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      const loserIndex = responses.findIndex((response) => response.status === 409);
      expect(responses[loserIndex].body).toMatchObject({
        code: 'WORKFLOW_SOURCE_KEY_CONFLICT',
        sourceKey: RACE_SOURCE_KEY,
      });
      const [winnerId, loserId] =
        loserIndex === 1 ? [RACE_A_ID, RACE_B_ID] : [RACE_B_ID, RACE_A_ID];
      expect(await findRows(winnerId)).toMatchObject([{ version: 1, status: 'published' }]);
      expect(await findRows(loserId)).toMatchObject([{ version: 1, status: 'draft' }]);
    });

    it('answers 404 for a version or a family nobody stored', async () => {
      await publish(FLOW_ID, 9).expect(404).expect(NOT_FOUND);
      await publish(UNKNOWN_ID, 1).expect(404).expect(NOT_FOUND);
    });
  });
});
