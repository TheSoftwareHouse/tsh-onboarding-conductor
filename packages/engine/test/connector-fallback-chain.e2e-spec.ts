import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { MockEmailDeliveryConnector } from '../src/connectors/adapters/fixtures/mock-email-delivery.connector';
import { WorkflowConnectorExecutorService } from '../src/connectors/workflow-connector-executor.service';
import { startE2eServer } from './e2e-server';

const WORKFLOW_ID = 'connector-fallback-chain';
const RECIPIENT = 'person@example.com';
const TEMPLATE_ID = 'd-e2e-template';

/** What the primary declares, and therefore how long the chain is expected to wait in total. */
const PRIMARY_RETRY = { maxAttempts: 3, delayMs: 50 };
const EXPECTED_WAIT_MS = (PRIMARY_RETRY.maxAttempts - 1) * PRIMARY_RETRY.delayMs;

/**
 * A three-link chain of the same capability. All three ids resolve to the email-delivery fixture
 * (`CONNECTOR_MOCKS` maps the two provider ids onto it), so each link's behaviour comes from its
 * own `config`: the first two are told to fail, the last one delivers. That is the only way to
 * exercise a chain longer than one hop without a real provider outage.
 */
const writeChainWorkflow = (directory: string) => {
  writeFileSync(
    path.join(directory, 'connector-fallback-chain.workflow.json'),
    JSON.stringify({
      id: WORKFLOW_ID,
      version: 1,
      initial: 'send_notification',
      steps: [
        {
          name: 'send_notification',
          type: 'notify',
          config: {
            connector: {
              name: 'primary_email',
              id: 'sendgrid_email',
              errorHandler: 'retry_then_fallback',
              retry: PRIMARY_RETRY,
              fieldMapping: { templateId: 'emailTemplateId' },
              config: { failWithStatus: 503 },
              fallback: [
                {
                  name: 'unavailable_email',
                  id: 'smtp',
                  // One attempt only: this link overrides the primary's policy field-wise.
                  retry: { maxAttempts: 1 },
                  config: { failWithStatus: 503 },
                },
                { name: 'last_resort_email', id: 'mock_email_delivery' },
              ],
            },
            recipientField: 'email',
          },
          include: [
            {
              type: 'form',
              config: {
                fields: {
                  email: { type: 'text', required: true, validation: { format: 'email' } },
                  emailTemplateId: { type: 'text', required: true, validation: { minLength: 1 } },
                },
              },
            },
          ],
          edges: { success: 'approved' },
        },
        { name: 'approved', type: 'terminal', config: { outcome: 'approved' } },
      ],
    }),
  );
};

type ConnectorAuditRow = {
  action: string;
  metadata: {
    connectorId: string;
    attempt: number;
    retryDelayMs?: number;
    fallbackConnectorId?: string;
    fallbackPosition?: number;
  };
};

describe('Connector fallback chain (e2e)', () => {
  let app: NestExpressApplication | undefined;
  let workflowsDir: string | undefined;

  const createdOnboardingIds = new Set<string>();

  const getApp = (): NestExpressApplication => {
    if (!app) {
      throw new Error('Test app not initialized');
    }

    return app;
  };

  const http = () => request(getApp().getHttpServer());

  const deliveryMock = (): MockEmailDeliveryConnector => getApp().get(MockEmailDeliveryConnector);

  const readOnboarding = async (onboardingId: string) => {
    const rows = (await getApp()
      .get(DataSource)
      .query('SELECT status, current_step FROM onboardings WHERE id = $1', [
        onboardingId,
      ])) as Array<{ status: string; current_step: string | null }>;

    return rows[0];
  };

  const readConnectorAudit = async (onboardingId: string): Promise<ConnectorAuditRow[]> => {
    await getApp().get(WorkflowConnectorExecutorService).flushConnectorFailureAudits();

    return (await getApp()
      .get(DataSource)
      .query(
        `SELECT action, metadata
           FROM audit_log
          WHERE resource_id = $1 AND action LIKE 'connector.%'
          ORDER BY occurred_at, id`,
        [onboardingId],
      )) as ConnectorAuditRow[];
  };

  beforeAll(async () => {
    workflowsDir = mkdtempSync(path.join(tmpdir(), 'engine-fallback-chain-workflows-'));
    writeChainWorkflow(workflowsDir);

    // Sibling suites in this process point this at a live server of their own, so it is reset
    // rather than inherited; everything else comes from .env.
    process.env.CLIENT_WEBHOOK_BASE_URL = '';
    process.env.WORKFLOWS_USERS_DIR = workflowsDir;
    // Both provider ids in the chain are served by the delivery fixture, so all three links run
    // in-process and each behaves as its own `config` tells it to. Stated in full rather than
    // appended to `.env`'s pairs, so the scenario does not depend on what that file happens to say.
    process.env.CONNECTOR_MOCKS = 'sendgrid_email:mock_email_delivery,smtp:mock_email_delivery';

    const { createApp } = await import('../src/main');

    const appBundle = await createApp();
    app = appBundle.app;
    await startE2eServer(app);
  });

  afterAll(async () => {
    if (app && createdOnboardingIds.size > 0) {
      const onboardingIds = Array.from(createdOnboardingIds);

      await getApp()
        .get(DataSource)
        .query('DELETE FROM audit_log WHERE resource_id = ANY($1::text[])', [onboardingIds]);
      await getApp()
        .get(DataSource)
        .query('DELETE FROM client_webhook_outbox WHERE onboarding_id = ANY($1::uuid[])', [
          onboardingIds,
        ]);
      await getApp()
        .get(DataSource)
        .query('DELETE FROM onboardings WHERE id = ANY($1::uuid[])', [onboardingIds]);
      await getApp().get(DataSource).query('DELETE FROM workflows WHERE key = $1', [WORKFLOW_ID]);
    }

    await app?.close();

    if (workflowsDir) {
      rmSync(workflowsDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    deliveryMock().__resetForTests();
  });

  it('falls through both failing links, delivers on the last, and advances the onboarding', async () => {
    const created = await http().post('/v1/onboardings').send({ workflowId: WORKFLOW_ID });
    const onboardingId = created.body.onboardingId as string;
    createdOnboardingIds.add(onboardingId);

    const startedAt = Date.now();
    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ email: RECIPIENT, emailTemplateId: TEMPLATE_ID })
      .expect(201);
    const elapsedMs = Date.now() - startedAt;

    // Only the last link delivers: the two before it were configured to fail.
    expect(deliveryMock().__peekDeliveredEmailsForTests(onboardingId)).toHaveLength(1);
    expect(await readOnboarding(onboardingId)).toMatchObject({ status: 'approved' });
    // The primary's two waits are real time the submit spent, not a mocked clock.
    expect(elapsedMs).toBeGreaterThanOrEqual(EXPECTED_WAIT_MS);
  });

  it('records one audit row per decision, naming each attempt, interval and chain position', async () => {
    const created = await http().post('/v1/onboardings').send({ workflowId: WORKFLOW_ID });
    const onboardingId = created.body.onboardingId as string;
    createdOnboardingIds.add(onboardingId);

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ email: RECIPIENT, emailTemplateId: TEMPLATE_ID })
      .expect(201);

    const rows = await readConnectorAudit(onboardingId);

    expect(rows.map((row) => row.action)).toEqual([
      'connector.failure_retried',
      'connector.failure_retried',
      'connector.failure_fell_back',
      'connector.failure_fell_back',
    ]);

    // The primary spends the three attempts it declared, waiting its own interval between them.
    expect(
      rows.slice(0, 2).map(({ metadata }) => [metadata.attempt, metadata.retryDelayMs]),
    ).toEqual([
      [1, PRIMARY_RETRY.delayMs],
      [2, PRIMARY_RETRY.delayMs],
    ]);

    // Then each hop names the link taking over and where in the chain it sits.
    expect(
      rows
        .slice(2)
        .map(({ metadata }) => [
          metadata.connectorId,
          metadata.fallbackConnectorId,
          metadata.fallbackPosition,
        ]),
    ).toEqual([
      ['sendgrid_email', 'smtp', 1],
      ['smtp', 'mock_email_delivery', 2],
    ]);
  });
});
