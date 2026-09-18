import { randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { type AgreementType } from '../src/agreements/agreement.types';
import { MAX_PAGINATION_LIMIT } from '../src/pagination';
import { WebhookEventType } from '../src/webhook/webhook-event';

const TERMS_TYPE: AgreementType = 'terms_and_conditions';
const PRIVACY_TYPE: AgreementType = 'privacy_notice';

const DECLARING_WORKFLOW_ID = 'agreement-versioning';
const UNPUBLISHED_WORKFLOW_ID = 'agreement-versioning-unpublished';
/** Declares no agreements at all, which is how an onboarding with no links is produced. */
const PLAIN_WORKFLOW_ID = 'agreement-versioning-plain';

/**
 * Every family this suite publishes carries a per-run suffix.
 *
 * The e2e database outlives a run, and the arc below asserts exact version numbers — a fixed key
 * would be at version 3 on the second run and at version 5 on the third. The suffix is also what
 * keeps two of these keys from colliding with `base-terms` or with the `eu-b2c-*` families a
 * manual run may have left behind.
 *
 * `-` and lowercase hex both satisfy the `^[a-z0-9][a-z0-9-]*$` shape a key must take.
 */
const RUN_SUFFIX = randomUUID().slice(0, 8);
const TERMS_KEY = `e2e-terms-${RUN_SUFFIX}`;
/** Sorts before `TERMS_KEY` on `e2e-n` < `e2e-t`, which is what proves the per-family ordering. */
const NOTICE_KEY = `e2e-notice-${RUN_SUFFIX}`;
const UNPUBLISHED_KEY = `e2e-unpublished-${RUN_SUFFIX}`;
/** Its own family, so the three filter values can be produced without disturbing the arc above. */
const FILTER_KEY = `e2e-filter-${RUN_SUFFIX}`;
/** Published but deliberately never linked to anything, which is what accept must refuse. */
const UNLINKED_KEY = `e2e-unlinked-${RUN_SUFFIX}`;
const PUBLISHED_KEYS = [TERMS_KEY, NOTICE_KEY, FILTER_KEY, UNLINKED_KEY];

const originalClientWebhookBaseUrl = process.env.CLIENT_WEBHOOK_BASE_URL;
const originalWorkflowsUsersDir = process.env.WORKFLOWS_USERS_DIR;
const originalAdminAuthEnabled = process.env.ADMIN_AUTH_ENABLED;

/**
 * A workflow that collects an email, then collects the acceptance of one agreement family, then
 * approves. Modelled on `workflows/fixtures/base.workflow.json` but without its connectors: this
 * suite is about agreements, and a connector would only add a second reason for a submit to fail.
 *
 * The first transition opts out of the notify webhook so the outbox holds exactly one
 * `onboarding.state_changed` row from the start and one from the terminal submit — anything else
 * arriving in it is an agreement event, which is what the assertions read.
 */
const declaringWorkflow = (agreementKey: string) => ({
  id: DECLARING_WORKFLOW_ID,
  version: 1,
  initial: 'collect_email',
  webhook: { notify: { path: 'notify' } },
  agreements: [{ key: agreementKey, step: 'accept_terms', acceptedWhen: 'acceptedTerms' }],
  steps: [
    {
      name: 'collect_email',
      type: 'custom',
      config: {
        status: 'awaiting_user',
        data: { email: { type: 'text', required: true, validation: { format: 'email' } } },
        transitions: [{ status: 'success', target: 'accept_terms', webhook: { notify: false } }],
      },
    },
    {
      name: 'accept_terms',
      type: 'custom',
      config: {
        status: 'awaiting_user',
        data: {
          acceptedTerms: { type: 'boolean', required: true, validation: { oneOf: [true] } },
        },
        transitions: [{ status: 'success', target: 'approved' }],
      },
    },
    { name: 'approved', type: 'custom', config: { status: 'approved', data: {}, transitions: [] } },
  ],
});

/** Same shape, naming a family nothing ever publishes, so its every start is a 503. */
const unpublishedWorkflow = () => ({
  ...declaringWorkflow(UNPUBLISHED_KEY),
  id: UNPUBLISHED_WORKFLOW_ID,
});

/** Declares no `agreements` anywhere, so an onboarding on it holds no links. */
const plainWorkflow = () => ({
  id: PLAIN_WORKFLOW_ID,
  version: 1,
  initial: 'collect_email',
  webhook: { notify: { path: 'notify' } },
  steps: [
    {
      name: 'collect_email',
      type: 'custom',
      config: {
        status: 'awaiting_user',
        data: { email: { type: 'text', required: true, validation: { format: 'email' } } },
        transitions: [{ status: 'success', target: 'approved' }],
      },
    },
    { name: 'approved', type: 'custom', config: { status: 'approved', data: {}, transitions: [] } },
  ],
});

type AgreementBody = {
  id: string;
  key: string;
  type: AgreementType;
  version: number;
  publishedAt: string;
  linkedOnboardings: number;
};

type OnboardingAgreementItem = {
  key: string;
  type: AgreementType;
  latestAgreementId: string;
  latestVersion: number;
  acceptedVersion: number | null;
  acceptedAt: string | null;
  status: string;
};

type LinkRow = { agreement_id: string; status: string; accepted_at: Date | null; version: number };

type OutboxRow = {
  onboarding_id: string;
  event_type: string;
  endpoint_url: string;
  payload: Record<string, unknown>;
};

jest.setTimeout(30000);

describe('Agreements (e2e)', () => {
  let app: NestExpressApplication | null = null;
  let workflowsDir: string | null = null;
  let localWebhookServer: Server | null = null;
  let clientWebhookTestUrl = '';
  const createdOnboardingIds = new Set<string>();
  const publishedAgreementIds = new Set<string>();

  const getApp = (): NestExpressApplication => {
    if (!app) {
      throw new Error('Test app not initialized');
    }

    return app;
  };

  /**
   * `CLIENT_WEBHOOK_BASE_URL` is empty in `.env.dist`, and an empty base URL makes the engine
   * suppress every outbound notification and write no outbox row at all — which would make the
   * agreement-event assertion pass for the wrong reason. The suite therefore stands up an endpoint
   * of its own and points the engine at it.
   */
  const startLocalWebhookServer = async (): Promise<string> =>
    new Promise((resolve, reject) => {
      localWebhookServer = createServer((_request: IncomingMessage, response: ServerResponse) => {
        response.statusCode = 204;
        response.end();
      });

      localWebhookServer.once('error', reject);
      localWebhookServer.listen(0, '127.0.0.1', () => {
        const address = localWebhookServer?.address();

        if (!address || typeof address === 'string') {
          reject(new Error('Unable to resolve local webhook server address'));
          return;
        }

        resolve(`http://127.0.0.1:${address.port}/client-webhook`);
      });
    });

  const closeLocalWebhookServer = async () => {
    if (!localWebhookServer?.listening) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      localWebhookServer?.close((error) => (error ? reject(error) : resolve()));
    });
  };

  beforeAll(async () => {
    clientWebhookTestUrl = await startLocalWebhookServer();

    workflowsDir = mkdtempSync(path.join(tmpdir(), 'engine-agreement-workflows-'));
    for (const definition of [
      declaringWorkflow(TERMS_KEY),
      unpublishedWorkflow(),
      plainWorkflow(),
    ]) {
      writeFileSync(
        path.join(workflowsDir, `${definition.id}.workflow.json`),
        JSON.stringify(definition, null, 2),
      );
    }

    // This suite sends no Entra ID token; admin auth has its own e2e spec.
    process.env.ADMIN_AUTH_ENABLED = 'false';
    process.env.CLIENT_WEBHOOK_BASE_URL = clientWebhookTestUrl;
    process.env.WORKFLOWS_USERS_DIR = workflowsDir;

    const { AppModule } = await import('../src/app.module');

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({ bodyParser: false });
    app.useBodyParser('json', { strict: false });
    app.useBodyParser('urlencoded', { extended: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      const dataSource = app.get(DataSource);
      const onboardingIds = Array.from(createdOnboardingIds);

      if (onboardingIds.length > 0) {
        await dataSource.query(
          'DELETE FROM client_webhook_outbox WHERE onboarding_id = ANY($1::uuid[])',
          [onboardingIds],
        );
        await dataSource.query(
          'DELETE FROM audit_log WHERE resource_type = $1 AND resource_id = ANY($2::text[])',
          ['onboarding', onboardingIds],
        );
        // The link rows go with the onboarding through the FK's ON DELETE CASCADE, which is what
        // releases the ON DELETE RESTRICT the agreements below would otherwise hit.
        await dataSource.query('DELETE FROM onboardings WHERE id = ANY($1::uuid[])', [
          onboardingIds,
        ]);
      }

      if (publishedAgreementIds.size > 0) {
        await dataSource.query(
          'DELETE FROM audit_log WHERE resource_type = $1 AND resource_id = ANY($2::text[])',
          ['agreement', Array.from(publishedAgreementIds)],
        );
      }

      await dataSource.query('DELETE FROM agreements WHERE key = ANY($1::text[])', [
        PUBLISHED_KEYS,
      ]);
      // Startup published these throwaway workflows into the shared workflows table; leaving them
      // there would let a stale definition outlive the temporary directory.
      await dataSource.query('DELETE FROM workflows WHERE name = ANY($1::text[])', [
        [DECLARING_WORKFLOW_ID, UNPUBLISHED_WORKFLOW_ID, PLAIN_WORKFLOW_ID],
      ]);

      await app.close();
    }

    await closeLocalWebhookServer();

    if (originalClientWebhookBaseUrl === undefined) {
      delete process.env.CLIENT_WEBHOOK_BASE_URL;
    } else {
      process.env.CLIENT_WEBHOOK_BASE_URL = originalClientWebhookBaseUrl;
    }

    if (originalWorkflowsUsersDir === undefined) {
      delete process.env.WORKFLOWS_USERS_DIR;
    } else {
      process.env.WORKFLOWS_USERS_DIR = originalWorkflowsUsersDir;
    }

    if (originalAdminAuthEnabled === undefined) {
      delete process.env.ADMIN_AUTH_ENABLED;
    } else {
      process.env.ADMIN_AUTH_ENABLED = originalAdminAuthEnabled;
    }

    if (workflowsDir) {
      rmSync(workflowsDir, { recursive: true, force: true });
    }
  });

  const http = () => request(getApp().getHttpServer());

  const publish = async (key: string, type: AgreementType): Promise<AgreementBody> => {
    const response = await http().post('/v1/admin/agreements').send({ key, type }).expect(201);
    publishedAgreementIds.add(response.body.id as string);

    return response.body as AgreementBody;
  };

  const startOnboarding = async (workflowId: string): Promise<string> => {
    const response = await http().post('/v1/onboardings').send({ workflowId }).expect(201);
    const onboardingId = response.body.onboardingId as string;
    createdOnboardingIds.add(onboardingId);

    return onboardingId;
  };

  const submit = async (onboardingId: string, body: Record<string, unknown>) =>
    http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send(body)
      .expect((response) => expect([200, 201]).toContain(response.status));

  const listAgreements = async (onboardingId: string): Promise<OnboardingAgreementItem[]> => {
    const response = await http().get(`/v1/onboardings/${onboardingId}/agreements`).expect(200);
    expect(response.body.onboardingId).toBe(onboardingId);

    return response.body.items as OnboardingAgreementItem[];
  };

  const readAdminSummary = async (onboardingId: string): Promise<Record<string, unknown>> =>
    (await http().get(`/v1/onboardings/${onboardingId}`).expect(200)).body;

  /**
   * Narrowed to one workflow as well as the status: the e2e database carries every onboarding
   * every other suite and every earlier run left behind, and a page of the whole table would not
   * reliably contain the handful of rows a case here is about.
   */
  const listAdminIds = async (agreementStatus: string, workflowId: string): Promise<string[]> => {
    const response = await http()
      .get('/v1/onboardings')
      .query({ agreementStatus, workflowId, limit: MAX_PAGINATION_LIMIT })
      .expect(200);

    return (response.body.items as Array<{ onboardingId: string }>).map(
      (item) => item.onboardingId,
    );
  };

  const readLinks = async (onboardingId: string): Promise<LinkRow[]> =>
    getApp()
      .get(DataSource)
      .query(
        `SELECT link.agreement_version_id AS agreement_id, link.status, link.accepted_at,
                published.version
           FROM onboarding_agreements link
           JOIN agreement_versions published
             ON published.agreement_version_id = link.agreement_version_id
          WHERE link.onboarding_id = $1
          ORDER BY published.version`,
        [onboardingId],
      );

  const readOutboxRows = async (onboardingId: string): Promise<OutboxRow[]> =>
    getApp()
      .get(DataSource)
      .query(
        `SELECT onboarding_id, event_type, endpoint_url, payload
           FROM client_webhook_outbox
          WHERE onboarding_id = $1
          ORDER BY created_at ASC, id ASC`,
        [onboardingId],
      );

  /**
   * The arc the feature exists for, walked once in order: publish, start, accept, publish again,
   * accept again. The steps share one onboarding on purpose — each assertion is about what the
   * previous step left behind — so they are written as ordered cases rather than one long test,
   * which keeps a failure pointing at the step that caused it.
   */
  describe('the versioning arc of one agreement family', () => {
    let firstVersion: AgreementBody;
    let secondVersion: AgreementBody;
    let onboardingId = '';

    it('publishes the first version of a family nobody holds yet', async () => {
      firstVersion = await publish(TERMS_KEY, TERMS_TYPE);

      expect(firstVersion).toEqual({
        id: expect.any(String),
        key: TERMS_KEY,
        type: TERMS_TYPE,
        version: 1,
        publishedAt: expect.any(String),
        linkedOnboardings: 0,
      });
      expect(new Date(firstVersion.publishedAt).toISOString()).toBe(firstVersion.publishedAt);
    });

    it('links the published version as pending when an onboarding starts', async () => {
      onboardingId = await startOnboarding(DECLARING_WORKFLOW_ID);

      expect(await readLinks(onboardingId)).toEqual([
        {
          agreement_id: firstVersion.id,
          status: 'pending',
          accepted_at: null,
          version: 1,
        },
      ]);
      expect(await listAgreements(onboardingId)).toEqual([
        {
          key: TERMS_KEY,
          type: TERMS_TYPE,
          latestAgreementId: firstVersion.id,
          latestVersion: 1,
          acceptedVersion: null,
          acceptedAt: null,
          status: 'not_accepted',
        },
      ]);
      expect((await readAdminSummary(onboardingId)).agreementStatus).toBe('not_accepted');
    });

    it('accepts the link when the declaring step is submitted with its acceptance field true', async () => {
      await submit(onboardingId, { email: 'agreements@example.com' });
      await submit(onboardingId, { acceptedTerms: true });

      const links = await readLinks(onboardingId);
      expect(links).toHaveLength(1);
      expect(links[0]).toEqual(
        expect.objectContaining({ agreement_id: firstVersion.id, status: 'accepted', version: 1 }),
      );
      expect(links[0].accepted_at).toBeInstanceOf(Date);
    });

    it('reports the family as current once the only published version is accepted', async () => {
      const [item] = await listAgreements(onboardingId);

      expect(item).toEqual({
        key: TERMS_KEY,
        type: TERMS_TYPE,
        latestAgreementId: firstVersion.id,
        latestVersion: 1,
        acceptedVersion: 1,
        acceptedAt: expect.any(String),
        status: 'current',
      });
      expect((await readAdminSummary(onboardingId)).agreementStatus).toBe('current');
      expect(await listAdminIds('current', DECLARING_WORKFLOW_ID)).toContain(onboardingId);
    });

    it('puts the onboarding out of date when the next version is published', async () => {
      secondVersion = await publish(TERMS_KEY, TERMS_TYPE);

      expect(secondVersion).toEqual(
        expect.objectContaining({ key: TERMS_KEY, version: 2, linkedOnboardings: 1 }),
      );
      expect(await readLinks(onboardingId)).toEqual([
        expect.objectContaining({ agreement_id: firstVersion.id, status: 'accepted', version: 1 }),
        expect.objectContaining({
          agreement_id: secondVersion.id,
          status: 'pending',
          accepted_at: null,
          version: 2,
        }),
      ]);
      expect(await listAgreements(onboardingId)).toEqual([
        {
          key: TERMS_KEY,
          type: TERMS_TYPE,
          latestAgreementId: secondVersion.id,
          latestVersion: 2,
          acceptedVersion: 1,
          acceptedAt: expect.any(String),
          status: 'outdated',
        },
      ]);
      expect((await readAdminSummary(onboardingId)).agreementStatus).toBe('outdated');
      expect(await listAdminIds('outdated', DECLARING_WORKFLOW_ID)).toContain(onboardingId);
    });

    it('enqueues exactly one agreement notification for the onboarding the publish put behind', async () => {
      const agreementRows = (await readOutboxRows(onboardingId)).filter(
        (row) => row.event_type === WebhookEventType.ONBOARDING_AGREEMENT_PENDING,
      );

      expect(agreementRows).toHaveLength(1);
      expect(agreementRows[0].endpoint_url).toBe(`${clientWebhookTestUrl}/notify`);
      expect(agreementRows[0].payload).toEqual({
        version: 1,
        event: {
          id: expect.any(String),
          type: WebhookEventType.ONBOARDING_AGREEMENT_PENDING,
          occurredAt: expect.any(String),
        },
        onboarding: {
          id: onboardingId,
          workflowId: DECLARING_WORKFLOW_ID,
          workflowVersion: 1,
          status: 'approved',
        },
        agreement: {
          id: secondVersion.id,
          key: TERMS_KEY,
          type: TERMS_TYPE,
          version: 2,
          previousAcceptedVersion: 1,
        },
      });
    });

    it('returns the family to current when the new version is accepted on an approved onboarding', async () => {
      expect((await readAdminSummary(onboardingId)).status).toBe('approved');

      const response = await http()
        .post(`/v1/onboardings/${onboardingId}/agreements/${secondVersion.id}/accept`)
        .expect(200);

      expect(response.body).toEqual({
        onboardingId,
        agreementId: secondVersion.id,
        key: TERMS_KEY,
        version: 2,
        acceptedAt: expect.any(String),
      });
      expect(new Date(response.body.acceptedAt).toISOString()).toBe(response.body.acceptedAt);

      expect(await listAgreements(onboardingId)).toEqual([
        expect.objectContaining({ latestVersion: 2, acceptedVersion: 2, status: 'current' }),
      ]);
      expect((await readAdminSummary(onboardingId)).agreementStatus).toBe('current');

      // A replayed acceptance keeps the first timestamp rather than moving it forward.
      const replayed = await http()
        .post(`/v1/onboardings/${onboardingId}/agreements/${secondVersion.id}/accept`)
        .expect(200);
      expect(replayed.body.acceptedAt).toBe(response.body.acceptedAt);
    });
  });

  describe('the per-onboarding agreement listing', () => {
    it('reports an onboarding holding no links as an empty list rather than a not-found', async () => {
      const onboardingId = await startOnboarding(PLAIN_WORKFLOW_ID);

      expect(await readLinks(onboardingId)).toEqual([]);
      expect(await listAgreements(onboardingId)).toEqual([]);
      expect((await readAdminSummary(onboardingId)).agreementStatus).toBe('not_accepted');
    });

    it('orders the families it holds by key', async () => {
      const notice = await publish(NOTICE_KEY, PRIVACY_TYPE);
      const onboardingId = await startOnboarding(DECLARING_WORKFLOW_ID);

      await http()
        .post(`/v1/onboardings/${onboardingId}/agreements`)
        .send({ agreementId: notice.id })
        .expect(200);

      expect((await listAgreements(onboardingId)).map((item) => item.key)).toEqual([
        NOTICE_KEY,
        TERMS_KEY,
      ]);
    });

    it('answers 404 for an onboarding that does not exist', async () => {
      const response = await http().get(`/v1/onboardings/${randomUUID()}/agreements`).expect(404);

      expect(response.body).toEqual(
        expect.objectContaining({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' }),
      );
    });
  });

  describe('linking a version to one onboarding', () => {
    it('creates the link once and notifies once, however many times it is called', async () => {
      const onboardingId = await startOnboarding(PLAIN_WORKFLOW_ID);
      const notice = (
        await http().get('/v1/admin/agreements').query({ key: NOTICE_KEY }).expect(200)
      ).body.items[0] as { id: string; version: number };

      const created = await http()
        .post(`/v1/onboardings/${onboardingId}/agreements`)
        .send({ agreementId: notice.id })
        .expect(200);

      expect(created.body).toEqual({
        onboardingId,
        agreementId: notice.id,
        key: NOTICE_KEY,
        version: notice.version,
        created: true,
      });

      const agreementRowsAfterCreate = (await readOutboxRows(onboardingId)).filter(
        (row) => row.event_type === WebhookEventType.ONBOARDING_AGREEMENT_PENDING,
      );
      expect(agreementRowsAfterCreate).toHaveLength(1);
      expect(agreementRowsAfterCreate[0].payload).toEqual(
        expect.objectContaining({
          agreement: expect.objectContaining({
            key: NOTICE_KEY,
            previousAcceptedVersion: null,
          }),
        }),
      );

      const repeated = await http()
        .post(`/v1/onboardings/${onboardingId}/agreements`)
        .send({ agreementId: notice.id })
        .expect(200);

      expect(repeated.body).toEqual({ ...created.body, created: false });
      expect(await readLinks(onboardingId)).toHaveLength(1);
      expect(
        (await readOutboxRows(onboardingId)).filter(
          (row) => row.event_type === WebhookEventType.ONBOARDING_AGREEMENT_PENDING,
        ),
      ).toHaveLength(1);
    });

    it('rejects an agreement id that is not a uuid', async () => {
      const onboardingId = await startOnboarding(PLAIN_WORKFLOW_ID);

      await http()
        .post(`/v1/onboardings/${onboardingId}/agreements`)
        .send({ agreementId: 'not-a-uuid' })
        .expect(400);
    });

    it('answers 404 for an agreement id that matches no published version', async () => {
      const onboardingId = await startOnboarding(PLAIN_WORKFLOW_ID);

      const response = await http()
        .post(`/v1/onboardings/${onboardingId}/agreements`)
        .send({ agreementId: randomUUID() })
        .expect(404);

      expect(response.body).toEqual(
        expect.objectContaining({ code: 'AGREEMENT_NOT_FOUND', message: 'AGREEMENT_NOT_FOUND' }),
      );
    });

    it('answers 404 for an onboarding that does not exist', async () => {
      const response = await http()
        .post(`/v1/onboardings/${randomUUID()}/agreements`)
        .send({ agreementId: randomUUID() })
        .expect(404);

      expect(response.body).toEqual(
        expect.objectContaining({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' }),
      );
    });
  });

  describe('accepting a version', () => {
    it('answers 404 for a version the onboarding was never linked to', async () => {
      const unlinked = await publish(UNLINKED_KEY, TERMS_TYPE);
      const onboardingId = await startOnboarding(PLAIN_WORKFLOW_ID);

      const response = await http()
        .post(`/v1/onboardings/${onboardingId}/agreements/${unlinked.id}/accept`)
        .expect(404);

      expect(response.body).toEqual(
        expect.objectContaining({ code: 'AGREEMENT_NOT_FOUND', message: 'AGREEMENT_NOT_FOUND' }),
      );
      expect(await readLinks(onboardingId)).toEqual([]);
    });
  });

  describe('the admin list filter', () => {
    it('returns the onboardings each of the three statuses describes, and rejects anything else', async () => {
      const first = await publish(FILTER_KEY, TERMS_TYPE);

      // Three onboardings on one family: one that never accepted, one that accepted the version
      // that is still latest, and one that accepted a version a later publish superseded.
      const notAcceptedId = await startOnboarding(PLAIN_WORKFLOW_ID);
      await http()
        .post(`/v1/onboardings/${notAcceptedId}/agreements`)
        .send({ agreementId: first.id })
        .expect(200);

      const outdatedId = await startOnboarding(PLAIN_WORKFLOW_ID);
      await http()
        .post(`/v1/onboardings/${outdatedId}/agreements`)
        .send({ agreementId: first.id })
        .expect(200);
      await http().post(`/v1/onboardings/${outdatedId}/agreements/${first.id}/accept`).expect(200);

      const second = await publish(FILTER_KEY, TERMS_TYPE);
      expect(second.version).toBe(2);

      const currentId = await startOnboarding(PLAIN_WORKFLOW_ID);
      await http()
        .post(`/v1/onboardings/${currentId}/agreements`)
        .send({ agreementId: second.id })
        .expect(200);
      await http().post(`/v1/onboardings/${currentId}/agreements/${second.id}/accept`).expect(200);

      const notAccepted = await listAdminIds('not_accepted', PLAIN_WORKFLOW_ID);
      expect(notAccepted).toContain(notAcceptedId);
      expect(notAccepted).not.toContain(outdatedId);
      expect(notAccepted).not.toContain(currentId);

      const outdated = await listAdminIds('outdated', PLAIN_WORKFLOW_ID);
      expect(outdated).toContain(outdatedId);
      expect(outdated).not.toContain(notAcceptedId);
      expect(outdated).not.toContain(currentId);

      const current = await listAdminIds('current', PLAIN_WORKFLOW_ID);
      expect(current).toContain(currentId);
      expect(current).not.toContain(notAcceptedId);
      expect(current).not.toContain(outdatedId);

      for (const rejected of ['CURRENT', 'pending', '']) {
        await http().get('/v1/onboardings').query({ agreementStatus: rejected }).expect(400);
      }
    });
  });

  describe('publishing', () => {
    it('refuses a family published under a different type', async () => {
      const response = await http()
        .post('/v1/admin/agreements')
        .send({ key: TERMS_KEY, type: PRIVACY_TYPE })
        .expect(400);

      expect(response.body).toEqual(
        expect.objectContaining({
          code: 'AGREEMENT_TYPE_MISMATCH',
          publishedType: TERMS_TYPE,
          requestedType: PRIVACY_TYPE,
        }),
      );
    });

    it('refuses a key that is not a family name and a type outside the declared set', async () => {
      await http()
        .post('/v1/admin/agreements')
        .send({ key: 'Not A Key', type: TERMS_TYPE })
        .expect(400);
      await http()
        .post('/v1/admin/agreements')
        .send({ key: TERMS_KEY, type: 'something_else' })
        .expect(400);
    });
  });

  describe('a workflow declaring a family with nothing published', () => {
    it('refuses the start with 503 AGREEMENT_NOT_PUBLISHED and creates no onboarding', async () => {
      const countOnboardingsForWorkflow = `SELECT count(*)::int AS total
           FROM onboardings o
           JOIN workflow_versions wv ON wv.workflow_version_id = o.workflow_version_id
           JOIN workflows w ON w.workflow_id = wv.workflow_id
          WHERE w.name = $1`;

      const onboardingsBefore = await getApp()
        .get(DataSource)
        .query(countOnboardingsForWorkflow, [UNPUBLISHED_WORKFLOW_ID]);

      const response = await http()
        .post('/v1/onboardings')
        .send({ workflowId: UNPUBLISHED_WORKFLOW_ID })
        .expect(503);

      expect(response.body).toEqual(
        expect.objectContaining({
          code: 'AGREEMENT_NOT_PUBLISHED',
          message: 'AGREEMENT_NOT_PUBLISHED',
          key: UNPUBLISHED_KEY,
        }),
      );
      expect(
        await getApp()
          .get(DataSource)
          .query(countOnboardingsForWorkflow, [UNPUBLISHED_WORKFLOW_ID]),
      ).toEqual(onboardingsBefore);
    });
  });
});
