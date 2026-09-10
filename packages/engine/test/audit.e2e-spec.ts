import { randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, Server } from 'node:http';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { MockAsyncCallbackConnector } from '../src/connectors/adapters/fixtures/mock-async-callback.connector';
import { MockPhoneVerificationConnector } from '../src/connectors/adapters/fixtures/mock-verification.connector';
import {
  ConnectorExecutionResult,
  type ConnectorRejectionReason,
} from '../src/connectors/ports/connector-execution-result';
import { WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT } from '../src/connectors/ports/connector-execution.port';
import { AuditService } from '../src/audit/audit.service';
import {
  ONBOARDING_REJECTED_ATTEMPT_ACTION,
  isAuditAction,
  ONBOARDING_TRANSITION_ACTIONS,
} from '../src/audit/audit.types';
import { ClientWebhookUrlResolver } from '../src/config/client-webhook-url-resolver';
import { HttpDeliveryService } from '../src/webhook/delivery/http-delivery.service';
import { WebhookRepository } from '../src/webhook/webhook.repository';
import { WebhookService } from '../src/webhook/webhook.service';
import { Workflow } from '../src/workflows/domain/workflow';
import { WorkflowEvaluationResult } from '../src/workflows/domain/workflow';
import { WorkflowRegistryService } from '../src/workflows/workflow-registry.service';
import * as uuidUtil from '../src/utils/uuid.util';
import { normalizeUntypedSteps } from '../src/workflows/testing/untyped-steps.helper';
import { startE2eServer } from './e2e-server';

jest.setTimeout(120000);

type AuditLogRow = {
  id: string;
  occurred_at: string;
  actor_type: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  hash_prev: string | null;
  hash_self: string | null;
};

type AuditLogIndexRow = {
  indexname: string;
  indexdef: string;
};

type AuditLogColumnRow = {
  column_name: string;
  udt_name: string;
  is_nullable: 'YES' | 'NO';
};

type MockCallbackOptions = Readonly<{
  status?: 'accepted' | 'rejected' | 'invalid' | 'invalid-data';
  reason?: ConnectorRejectionReason;
  errors?: Record<string, readonly string[]>;
}>;

const UNRESOLVED_PROVIDER_CALLBACK_RESOURCE_ID = 'unresolved';
const TWILIO_PHONE_NUMBER = '+15551234567';
/** Twilio's own attempt budget, which the mock standing in for it reproduces. */
const TWILIO_MAX_ATTEMPTS = 5;

let app: NestExpressApplication | null = null;
let webhookServer: Server | null = null;
let webhookResponseMode: 'success' | 'failure' = 'success';
let nestedCallbackWorkflow: Workflow;

const createdOnboardingIds = new Set<string>();
const createdAuditIds = new Set<string>();

const readRawRequestBody = async (request: IncomingMessage): Promise<void> => {
  for await (const chunk of request) {
    void chunk;
  }
};

const startLocalWebhookServer = async (): Promise<string> =>
  new Promise((resolve, reject) => {
    webhookServer = createServer((request, response) => {
      void readRawRequestBody(request).finally(() => {
        if (webhookResponseMode === 'failure') {
          response.statusCode = 503;
          response.end('client webhook unavailable');
          return;
        }

        response.statusCode = 204;
        response.end();
      });
    });

    webhookServer.once('error', reject);
    webhookServer.listen(0, '127.0.0.1', () => {
      const address = webhookServer?.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to resolve local webhook server address'));
        return;
      }

      resolve(`http://127.0.0.1:${address.port}/client-webhook`);
    });
  });

const closeLocalWebhookServer = async () => {
  if (!webhookServer?.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    webhookServer?.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

const getApp = (): NestExpressApplication => {
  if (!app) {
    throw new Error('Test app not initialized');
  }

  return app;
};

const dataSource = (): DataSource => getApp().get(DataSource);

const seedAcceptedSubmitOnboarding = async (): Promise<string> => {
  const onboardingId = randomUUID();
  const email = `audit-${onboardingId.replace(/-/g, '')}@example.com`;

  await dataSource().query(
    `INSERT INTO onboardings (
      id,
      workflow_id,
      workflow_version,
      status,
      current_step,
      context,
      expires_at,
      created_at,
      updated_at,
      completed_at
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW(), NOW(), $8)`,
    [
      onboardingId,
      'base',
      1,
      'awaiting_user',
      'accept_terms',
      JSON.stringify({ email }),
      null,
      null,
    ],
  );

  createdOnboardingIds.add(onboardingId);
  return onboardingId;
};

const seedManualReviewOnboarding = async (): Promise<string> => {
  const onboardingId = randomUUID();

  await dataSource().query(
    `INSERT INTO onboardings (
      id,
      workflow_id,
      workflow_version,
      status,
      current_step,
      context,
      expires_at,
      created_at,
      updated_at,
      completed_at
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW(), NOW(), $8)`,
    [
      onboardingId,
      'manual-review',
      1,
      'awaiting_manual_review',
      'awaiting_manual_review',
      JSON.stringify({}),
      null,
      null,
    ],
  );

  createdOnboardingIds.add(onboardingId);
  return onboardingId;
};

const seedCallbackOnboarding = async (): Promise<string> => {
  const onboardingId = randomUUID();

  await dataSource().query(
    `INSERT INTO onboardings (
      id,
      workflow_id,
      workflow_version,
      status,
      current_step,
      context,
      expires_at,
      created_at,
      updated_at,
      completed_at
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW(), NOW(), $8)`,
    [onboardingId, 'base', 1, 'awaiting_user', 'collect_email', JSON.stringify({}), null, null],
  );

  createdOnboardingIds.add(onboardingId);
  return onboardingId;
};

const createNestedSubmittedData = (onboardingId: string): Record<string, unknown> => ({
  email: `callback-${onboardingId.replace(/-/g, '')}@example.com`,
  profile: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    preferredChannels: ['email', 'sms'],
  },
  consent: {
    newsletter: true,
    termsAcceptedAt: '2026-08-03T10:00:00.000Z',
  },
});

const createNestedCallbackWorkflow = (): Workflow =>
  new Workflow(
    normalizeUntypedSteps({
      id: 'base',
      version: 1,
      name: 'Base',
      initial: 'collect_email',
      webhook: {
        notify: {
          path: 'notify',
        },
      },
      steps: [
        {
          name: 'collect_email',
          status: 'awaiting_user',
          data: {
            email: {
              type: 'text',
              required: true,
              validation: {
                format: 'email',
              },
            },
            profile: {
              type: 'object',
              required: false,
              persist: false,
              fields: {
                firstName: {
                  type: 'text',
                  required: true,
                },
                lastName: {
                  type: 'text',
                  required: true,
                },
                preferredChannels: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'text',
                  },
                },
              },
            },
            consent: {
              type: 'object',
              required: false,
              persist: false,
              fields: {
                newsletter: {
                  type: 'boolean',
                  required: true,
                },
                termsAcceptedAt: {
                  type: 'text',
                  required: true,
                },
              },
            },
          },
          connectors: [
            {
              name: 'mock_kyc_1',
              id: 'mock_kyc_1',
              type: 'kyc',
              order: 1,
              fieldMapping: {
                email: 'email',
              },
            },
          ],
          transitions: [
            {
              status: 'success',
              target: 'accept_terms',
              webhook: {
                notify: false,
              },
            },
          ],
        },
        {
          name: 'accept_terms',
          status: 'awaiting_user',
          data: {
            acceptedTerms: {
              type: 'boolean',
              required: true,
              validation: {
                oneOf: [true],
              },
            },
          },
          transitions: [
            {
              status: 'success',
              target: 'approved',
            },
          ],
        },
        {
          connectors: [
            {
              name: 'mock_kyc_1',
              id: 'mock_kyc_1',
              type: 'kyc',
              order: 1,
              fieldMapping: {
                email: 'email',
              },
            },
            {
              name: 'mock_kyc_2',
              id: 'mock_kyc_2',
              type: 'kyc',
              order: 2,
              fieldMapping: {
                email: 'email',
                acceptedTerms: 'acceptedTerms',
              },
            },
          ],
          name: 'approved',
          status: 'approved',
          data: {},
          transitions: [],
        },
      ],
    }),
  );

type GetById = WorkflowRegistryService['getById'];

/**
 * Layers one `getById` override on top of whatever is already installed.
 * `jest.spyOn` hands back the same mock when the method is already spied, so
 * binding the method would make the new override delegate to itself; taking the
 * current mock implementation instead keeps the delegation chain intact.
 */
const overrideGetById = (build: (previous: GetById) => GetById): void => {
  const workflowRegistryService = getApp().get(WorkflowRegistryService);
  const currentGetById = workflowRegistryService.getById;
  const previousGetById = jest.isMockFunction(currentGetById)
    ? ((currentGetById.getMockImplementation() ?? currentGetById) as GetById)
    : (currentGetById.bind(workflowRegistryService) as GetById);

  jest.spyOn(workflowRegistryService, 'getById').mockImplementation(build(previousGetById));
};

/**
 * `getById` reads the table on every call and builds a fresh `Workflow`, so
 * spying on one returned instance would not reach the one a request builds.
 * Pinning the instance through the registry restores that identity for the
 * revision under test while every other lookup still hits the database.
 */
const pinWorkflowInstance = async (workflowId: string, version: number): Promise<Workflow> => {
  const workflowRegistryService = getApp().get(WorkflowRegistryService);
  const pinnedWorkflow = await workflowRegistryService.getById(workflowId, version);

  overrideGetById(
    (originalGetById) => async (requestedId, requestedVersion, manager) =>
      requestedId === workflowId && (requestedVersion === undefined || requestedVersion === version)
        ? pinnedWorkflow
        : originalGetById(requestedId, requestedVersion, manager),
  );

  return pinnedWorkflow;
};

const installNestedCallbackWorkflowMock = () => {
  nestedCallbackWorkflow = createNestedCallbackWorkflow();

  overrideGetById((originalGetById) => async (workflowId, version, manager) => {
    if (workflowId === 'base' && (version === undefined || version === 1)) {
      return nestedCallbackWorkflow;
    }

    return originalGetById(workflowId, version, manager);
  });
};

const prepareMockAsyncCallback = async (
  onboardingId: string,
  submittedData: Record<string, unknown>,
  options: MockCallbackOptions = {},
) => {
  const connector = getApp().get(MockAsyncCallbackConnector);

  await connector.execute({
    declaration: {
      order: 1,
      config: {},
    },
    execution: {
      onboardingId,
      stepName: 'collect_email',
    },
    context: {},
    payload: {},
    payloadFieldSources: {},
  } as never);

  const initiation = connector.getLatestInitiation();
  if (!initiation) {
    throw new Error('Mock async callback initiation was not created');
  }

  return connector.emitProviderCallback({
    providerReference: initiation.providerReference,
    submittedData,
    status: options.status,
    reason: options.reason,
    errors: options.errors,
  });
};

const seedAuditRows = async (
  rows: Array<{
    id: string;
    occurredAt: string;
    actorType: string;
    actorId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  }>,
) => {
  const insertedIds: string[] = [];

  for (const row of rows) {
    const id = row.id;
    await dataSource().query(
      `INSERT INTO audit_log (
        id,
        occurred_at,
        actor_type,
        actor_id,
        action,
        resource_type,
        resource_id,
        before,
        after,
        metadata,
        hash_prev,
        hash_self
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)`,
      [
        id,
        row.occurredAt,
        row.actorType,
        row.actorId,
        row.action,
        row.resourceType,
        row.resourceId,
        null,
        null,
        JSON.stringify(row.metadata),
        null,
        null,
      ],
    );
    createdAuditIds.add(id);
    insertedIds.push(id);
  }

  return insertedIds;
};

const readAuditRows = async (resourceId: string): Promise<AuditLogRow[]> => {
  return dataSource().query(
    `SELECT
      id,
      occurred_at,
      actor_type,
      actor_id,
      action,
      resource_type,
      resource_id,
      before,
      after,
      metadata,
      hash_prev,
      hash_self
     FROM audit_log
     WHERE resource_type = 'onboarding' AND resource_id = $1 AND action NOT LIKE 'webhook.%'
     ORDER BY occurred_at DESC, id DESC`,
    [resourceId],
  );
};

const readOutboxRows = async (onboardingId: string) => {
  return dataSource().query(
    `SELECT id, onboarding_id, event_type, endpoint_url, payload, status, attempts, delivered_at
     FROM client_webhook_outbox
     WHERE onboarding_id = $1
     ORDER BY created_at ASC, id ASC`,
    [onboardingId],
  );
};

const deliverOutbox = async (outboxId: string): Promise<void> => {
  await dataSource().query(
    `UPDATE client_webhook_outbox
    SET next_delivery_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
    WHERE id = $1`,
    [outboxId],
  );
  await app!.get(HttpDeliveryService).deliverDue(outboxId);
};

const submitAcceptedOnboarding = async (onboardingId: string) => {
  const response = await request(getApp().getHttpServer())
    .post(`/v1/onboardings/${onboardingId}/submit`)
    .send({ acceptedTerms: true })
    .expect((result) => expect([200, 201]).toContain(result.status));

  expect(response.body).toEqual({
    appliedStep: 'accept_terms',
    status: 'approved',
    currentStep: null,
    rejectionReason: null,
  });

  return response;
};

const failOutboundAuditWhenActionMatches = (action: string, message: string) => {
  const auditService = getApp().get(AuditService);
  const originalLogWebhook = auditService.logWebhook.bind(auditService);

  jest.spyOn(auditService, 'logWebhook').mockImplementation(async (manager, input) => {
    if (input.action === action) {
      throw new Error(message);
    }

    return originalLogWebhook(manager, input);
  });
};

const readWebhookAuditRows = async (resourceId: string): Promise<AuditLogRow[]> => {
  return dataSource().query(
    `SELECT
      id,
      occurred_at,
      actor_type,
      actor_id,
      action,
      resource_type,
      resource_id,
      before,
      after,
      metadata,
      hash_prev,
      hash_self
     FROM audit_log
     WHERE resource_type = 'client_webhook_outbox' AND resource_id = $1
     ORDER BY occurred_at DESC, id DESC`,
    [resourceId],
  );
};

const readInboundCallbackAuditRows = async (
  resourceId: string = UNRESOLVED_PROVIDER_CALLBACK_RESOURCE_ID,
): Promise<AuditLogRow[]> => {
  return dataSource().query(
    `SELECT
      id,
      occurred_at,
      actor_type,
      actor_id,
      action,
      resource_type,
      resource_id,
      before,
      after,
      metadata,
      hash_prev,
      hash_self
     FROM audit_log
     WHERE resource_type = 'provider_callback' AND resource_id = $1
     ORDER BY occurred_at DESC, id DESC`,
    [resourceId],
  );
};

const readOnboardingAuditRows = async (resourceId: string): Promise<AuditLogRow[]> => {
  return dataSource().query(
    `SELECT
      id,
      occurred_at,
      actor_type,
      actor_id,
      action,
      resource_type,
      resource_id,
      before,
      after,
      metadata,
      hash_prev,
      hash_self
     FROM audit_log
     WHERE resource_type = 'onboarding' AND resource_id = $1
     ORDER BY occurred_at DESC, id DESC`,
    [resourceId],
  );
};

const expectExactAuditRow = (
  row: AuditLogRow | undefined,
  expected: {
    action: string;
    resourceType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  },
) => {
  expect(row).toEqual(
    expect.objectContaining({
      actor_type: 'system',
      actor_id: 'engine',
      action: expected.action,
      resource_type: expected.resourceType,
      resource_id: expected.resourceId,
      before: expected.before ?? null,
      after: expected.after ?? null,
      metadata: expected.metadata,
      hash_prev: null,
      hash_self: null,
    }),
  );
  expect(row).toBeDefined();
  expect(Object.keys(row!.metadata).sort()).toEqual(Object.keys(expected.metadata).sort());
};

const readAppliedInboundAuditRows = async (onboardingId: string): Promise<AuditLogRow[]> => {
  return dataSource().query(
    `SELECT
      id,
      occurred_at,
      actor_type,
      actor_id,
      action,
      resource_type,
      resource_id,
      before,
      after,
      metadata,
      hash_prev,
      hash_self
     FROM audit_log
     WHERE resource_type = 'onboarding'
       AND resource_id = $1
       AND action = 'webhook.inbound_callback_applied'
     ORDER BY occurred_at DESC, id DESC`,
    [onboardingId],
  );
};

const waitForAuditRow = async (
  readRows: () => Promise<AuditLogRow[]>,
  predicate: (row: AuditLogRow) => boolean,
  options: {
    attempts?: number;
    intervalMs?: number;
  } = {},
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

const readOnboardingRows = async (onboardingId: string) => {
  return dataSource().query(
    `SELECT id, workflow_id, workflow_version, status, current_step, context, completed_at
     FROM onboardings
     WHERE id = $1`,
    [onboardingId],
  );
};

type LifecycleAuditExpectation = {
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
};

const startWorkflowOnboarding = async (
  workflowId: 'base' | 'manual-review' | 'twilio-verify',
  expectedCurrentStep: string,
  expectedStatus: 'awaiting_user' | 'awaiting_manual_review',
) => {
  const response = await request(getApp().getHttpServer())
    .post('/v1/onboardings')
    .send({ workflowId })
    .expect(201);

  expect(response.body).toEqual({
    onboardingId: expect.any(String),
    status: expectedStatus,
    currentStep: expectedCurrentStep,
    expiresAt: null,
  });

  const onboardingId = response.body.onboardingId as string;
  expect(onboardingId).not.toHaveLength(0);

  expect(await readOnboardingRows(onboardingId)).toEqual([
    expect.objectContaining({
      workflow_id: workflowId,
      workflow_version: 1,
      status: expectedStatus,
      current_step: expectedCurrentStep,
      context: {},
      completed_at: null,
    }),
  ]);

  createdOnboardingIds.add(onboardingId);
  return onboardingId;
};

const expectLifecycleAuditRows = async (
  resourceId: string,
  expectedRows: LifecycleAuditExpectation[],
  options?: { lifecycleOnly?: boolean },
) => {
  const allAuditRows = (await readAuditRows(resourceId)) as AuditLogRow[];
  const lifecycleOnly = options?.lifecycleOnly ?? true;
  const auditRows = lifecycleOnly
    ? allAuditRows.filter((row) => isAuditAction(ONBOARDING_TRANSITION_ACTIONS, row.action))
    : allAuditRows;

  expect(auditRows).toHaveLength(expectedRows.length);

  expectedRows.forEach((expectedRow, index) => {
    const actualRow = auditRows[index];

    expect(actualRow).toEqual(
      expect.objectContaining({
        actor_type: 'system',
        actor_id: 'engine',
        action: expectedRow.action,
        resource_type: 'onboarding',
        resource_id: resourceId,
        before: expectedRow.before,
        after: expectedRow.after,
        metadata: expectedRow.metadata,
        hash_prev: null,
        hash_self: null,
      }),
    );
    expect(Object.keys(actualRow.metadata).sort()).toEqual(
      Object.keys(expectedRow.metadata).sort(),
    );
  });
};

const expectLatestRejectedAttemptAuditRow = async (
  resourceId: string,
  expected: {
    operation: 'submit' | 'manual_review';
    outcome:
      | 'onboarding_not_found'
      | 'onboarding_completed'
      | 'retryable_invalid_data'
      | 'unknown_workflow_evaluation'
      | 'unsupported_action'
      | 'transition_unavailable';
  },
) => {
  const latestRow = await waitForAuditRow(
    async () => (await readAuditRows(resourceId)) as AuditLogRow[],
    (row) => row.action === 'onboarding.rejected_attempt',
  );

  const auditRows = (await readAuditRows(resourceId)) as AuditLogRow[];

  expect(latestRow).toEqual(
    expect.objectContaining({
      actor_type: 'system',
      actor_id: 'engine',
      action: 'onboarding.rejected_attempt',
      resource_type: 'onboarding',
      resource_id: resourceId,
      before: null,
      after: null,
      hash_prev: null,
      hash_self: null,
      metadata: {
        operation: expected.operation,
        outcome: expected.outcome,
      },
    }),
  );
  expect(latestRow).toBeDefined();
  expect(Object.keys(latestRow!.metadata).sort()).toEqual(['operation', 'outcome']);

  return auditRows;
};

const cleanupCreatedRows = async () => {
  const onboardingIds = Array.from(createdOnboardingIds);

  if (app) {
    await dataSource().query('DELETE FROM audit_log WHERE resource_type = $1', [
      'provider_callback',
    ]);

    const auditIds = Array.from(createdAuditIds);

    if (auditIds.length > 0) {
      await dataSource().query('DELETE FROM audit_log WHERE id = ANY($1::uuid[])', [auditIds]);
    }

    if (onboardingIds.length > 0) {
      await dataSource().query(
        'DELETE FROM client_webhook_outbox WHERE onboarding_id = ANY($1::uuid[])',
        [onboardingIds],
      );
      await dataSource().query(
        'DELETE FROM audit_log WHERE resource_type = $1 AND resource_id = ANY($2::text[])',
        ['onboarding', onboardingIds],
      );
      await dataSource().query('DELETE FROM onboardings WHERE id = ANY($1::uuid[])', [
        onboardingIds,
      ]);
    }
  }

  createdOnboardingIds.clear();
  createdAuditIds.clear();
};

describe('Audit transaction slice (e2e)', () => {
  beforeAll(async () => {
    const webhookBaseUrl = await startLocalWebhookServer();

    // This suite sends no Entra ID token; admin auth has its own e2e spec.
    process.env.ADMIN_AUTH_ENABLED = 'false';
    process.env.CLIENT_WEBHOOK_BASE_URL = webhookBaseUrl;
    process.env.CLIENT_WEBHOOK_TIMEOUT_MS = '150';
    // The OTP audit trail is driven through the mock standing in for twilio_verify, so the
    // suite needs no Twilio account and sends no messages.

    const { createApp } = await import('../src/main');

    const appBundle = await createApp();
    app = appBundle.app;
    app.use('/v1/webhooks/:providerKey/callback', (req, _response, next) => {
      if (req.headers['x-test-force-raw-body-rejection'] === '1') {
        req.body = { malformed: true };
      }

      next();
    });
    await startE2eServer(app);
  });

  beforeEach(() => {
    installNestedCallbackWorkflowMock();
  });

  afterEach(async () => {
    webhookResponseMode = 'success';
    await cleanupCreatedRows();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await cleanupCreatedRows();
    await closeLocalWebhookServer();
    await app?.close();
  });

  it('shows the audit_log schema and exactly the three explicit secondary indexes', async () => {
    const tableRows = (await dataSource().query(
      `SELECT to_regclass('public.audit_log') AS table_name`,
    )) as Array<{ table_name: string | null }>;
    expect(tableRows[0].table_name).toBe('audit_log');

    const columnRows = (await dataSource().query(
      `SELECT column_name, udt_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'audit_log'
       ORDER BY ordinal_position`,
    )) as AuditLogColumnRow[];

    expect(columnRows).toEqual([
      { column_name: 'id', udt_name: 'uuid', is_nullable: 'NO' },
      { column_name: 'occurred_at', udt_name: 'timestamptz', is_nullable: 'NO' },
      { column_name: 'actor_type', udt_name: 'varchar', is_nullable: 'NO' },
      { column_name: 'actor_id', udt_name: 'varchar', is_nullable: 'NO' },
      { column_name: 'action', udt_name: 'varchar', is_nullable: 'NO' },
      { column_name: 'resource_type', udt_name: 'varchar', is_nullable: 'NO' },
      { column_name: 'resource_id', udt_name: 'varchar', is_nullable: 'NO' },
      { column_name: 'before', udt_name: 'jsonb', is_nullable: 'YES' },
      { column_name: 'after', udt_name: 'jsonb', is_nullable: 'YES' },
      { column_name: 'metadata', udt_name: 'jsonb', is_nullable: 'NO' },
      { column_name: 'hash_prev', udt_name: 'varchar', is_nullable: 'YES' },
      { column_name: 'hash_self', udt_name: 'varchar', is_nullable: 'YES' },
      // Added by migration 0020, so it sits last in ordinal order.
      { column_name: 'entry_type', udt_name: 'varchar', is_nullable: 'NO' },
    ]);

    const pkeyRows = (await dataSource().query(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'audit_log' AND indexname = 'audit_log_pkey'`,
    )) as AuditLogIndexRow[];

    expect(pkeyRows).toEqual([
      expect.objectContaining({
        indexname: 'audit_log_pkey',
        indexdef: expect.stringContaining('(id)'),
      }),
    ]);

    const explicitIndexRows = (await dataSource().query(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'audit_log' AND indexname <> 'audit_log_pkey'
       ORDER BY indexname`,
    )) as AuditLogIndexRow[];

    expect(explicitIndexRows).toHaveLength(3);
    expect(explicitIndexRows).toEqual([
      // Partial: it carries only the rows an error listing reads, so the two thirds of writes
      // that are `success` or `observed` never maintain it.
      expect.objectContaining({
        indexname: 'idx_audit_log_errors',
        indexdef: expect.stringContaining('WHERE ((entry_type)::text = ANY'),
      }),
      expect.objectContaining({
        indexname: 'idx_audit_log_occurred_at',
        indexdef: expect.stringContaining('(occurred_at)'),
      }),
      expect.objectContaining({
        indexname: 'idx_audit_log_resource_type_resource_id',
        indexdef: expect.stringContaining('(resource_type, resource_id)'),
      }),
    ]);
  });

  it('persists one accepted-submit audit row with approved metadata and before/after snapshots when the transaction succeeds', async () => {
    const onboardingId = await seedAcceptedSubmitOnboarding();

    await submitAcceptedOnboarding(onboardingId);

    const auditRows = (await readAuditRows(onboardingId)) as AuditLogRow[];
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toEqual(
      expect.objectContaining({
        actor_type: 'system',
        actor_id: 'engine',
        action: 'onboarding.state_transition',
        resource_type: 'onboarding',
        resource_id: onboardingId,
        before: {
          id: onboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: 'accept_terms',
          scores: {},
        },
        after: {
          id: onboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'approved',
          currentStep: null,
          scores: {},
        },
        hash_prev: null,
        hash_self: null,
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: 'accept_terms',
          fromStatus: 'awaiting_user',
          toStatus: 'approved',
          fromCurrentStep: 'accept_terms',
          toCurrentStep: null,
          fromScores: {},
          toScores: {},
        },
      }),
    );

    const outboxRows = await readOutboxRows(onboardingId);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]).toEqual(
      expect.objectContaining({
        onboarding_id: onboardingId,
        event_type: 'onboarding.state_changed',
        status: 'PENDING',
        attempts: 0,
        delivered_at: null,
      }),
    );
  });

  it('rolls back outbound intent creation when transactional audit persistence fails', async () => {
    const onboardingId = await seedAcceptedSubmitOnboarding();

    failOutboundAuditWhenActionMatches(
      'webhook.outbound_intent_created',
      'forced outbound intent audit failure',
    );

    await submitAcceptedOnboarding(onboardingId);

    const onboardingRows = await readOnboardingRows(onboardingId);
    expect(onboardingRows).toEqual([
      expect.objectContaining({
        id: onboardingId,
        workflow_id: 'base',
        workflow_version: 1,
        status: 'approved',
        current_step: null,
        context: expect.objectContaining({
          email: expect.any(String),
          acceptedTerms: true,
        }),
        completed_at: expect.any(Date),
      }),
    ]);

    expect(await readAuditRows(onboardingId)).toHaveLength(1);
    expect(await readOutboxRows(onboardingId)).toHaveLength(0);
  });

  it('rolls back outbound delivery claim auditing when transactional audit persistence fails', async () => {
    const onboardingId = await seedAcceptedSubmitOnboarding();

    failOutboundAuditWhenActionMatches(
      'webhook.outbound_delivery_attempted',
      'forced outbound delivery-attempt audit failure',
    );

    await submitAcceptedOnboarding(onboardingId);

    const outboxRows = await readOutboxRows(onboardingId);
    expect(outboxRows).toHaveLength(1);
    await expect(deliverOutbox(outboxRows[0].id)).rejects.toThrow(
      'forced outbound delivery-attempt audit failure',
    );
    expect(outboxRows[0]).toEqual(
      expect.objectContaining({
        onboarding_id: onboardingId,
        event_type: 'onboarding.state_changed',
        status: 'PENDING',
        attempts: 0,
        delivered_at: null,
      }),
    );

    const outboxAuditRows = await readWebhookAuditRows(outboxRows[0].id);
    expect(outboxAuditRows).toHaveLength(1);
    expectExactAuditRow(
      outboxAuditRows.find((row) => row.action === 'webhook.outbound_intent_created'),
      {
        action: 'webhook.outbound_intent_created',
        resourceType: 'client_webhook_outbox',
        resourceId: outboxRows[0].id,
        metadata: {
          onboardingId,
          eventType: 'onboarding.state_changed',
          status: 'pending',
          attempt: 0,
          payload: outboxRows[0].payload,
        },
      },
    );
  });

  it('rolls back outbound delivery success auditing when transactional audit persistence fails', async () => {
    const onboardingId = await seedAcceptedSubmitOnboarding();

    failOutboundAuditWhenActionMatches(
      'webhook.outbound_delivery_succeeded',
      'forced outbound delivery-success audit failure',
    );

    await submitAcceptedOnboarding(onboardingId);

    const outboxRows = await readOutboxRows(onboardingId);
    expect(outboxRows).toHaveLength(1);
    await expect(deliverOutbox(outboxRows[0].id)).rejects.toThrow(
      'forced outbound delivery-success audit failure',
    );
    const refreshedOutboxRows = await readOutboxRows(onboardingId);
    expect(refreshedOutboxRows[0]).toEqual(
      expect.objectContaining({
        onboarding_id: onboardingId,
        event_type: 'onboarding.state_changed',
        status: 'SENDING',
        attempts: 1,
        delivered_at: null,
      }),
    );

    const outboxAuditRows = await readWebhookAuditRows(outboxRows[0].id);
    expect(outboxAuditRows).toHaveLength(2);
    expectExactAuditRow(
      outboxAuditRows.find((row) => row.action === 'webhook.outbound_intent_created'),
      {
        action: 'webhook.outbound_intent_created',
        resourceType: 'client_webhook_outbox',
        resourceId: outboxRows[0].id,
        metadata: {
          onboardingId,
          eventType: 'onboarding.state_changed',
          status: 'pending',
          attempt: 0,
          payload: outboxRows[0].payload,
        },
      },
    );
    expectExactAuditRow(
      outboxAuditRows.find((row) => row.action === 'webhook.outbound_delivery_attempted'),
      {
        action: 'webhook.outbound_delivery_attempted',
        resourceType: 'client_webhook_outbox',
        resourceId: outboxRows[0].id,
        metadata: {
          onboardingId,
          eventType: 'onboarding.state_changed',
          attempt: 1,
          payload: outboxRows[0].payload,
        },
      },
    );
    expect(
      outboxAuditRows.find((row) => row.action === 'webhook.outbound_delivery_succeeded'),
    ).toBeUndefined();
  });

  it('rolls back restored-pending state when transactional delivery-failure audit persistence fails', async () => {
    const onboardingId = await seedAcceptedSubmitOnboarding();

    failOutboundAuditWhenActionMatches(
      'webhook.outbound_delivery_failed',
      'forced outbound delivery-failure audit failure',
    );
    webhookResponseMode = 'failure';

    await submitAcceptedOnboarding(onboardingId);

    const outboxRows = await readOutboxRows(onboardingId);
    expect(outboxRows).toHaveLength(1);
    await expect(deliverOutbox(outboxRows[0].id)).rejects.toThrow(
      'forced outbound delivery-failure audit failure',
    );
    const refreshedOutboxRows = await readOutboxRows(onboardingId);
    expect(refreshedOutboxRows[0]).toEqual(
      expect.objectContaining({
        onboarding_id: onboardingId,
        event_type: 'onboarding.state_changed',
        status: 'SENDING',
        attempts: 1,
        delivered_at: null,
      }),
    );

    const outboxAuditRows = await readWebhookAuditRows(outboxRows[0].id);
    expect(outboxAuditRows).toHaveLength(2);
    expectExactAuditRow(
      outboxAuditRows.find((row) => row.action === 'webhook.outbound_intent_created'),
      {
        action: 'webhook.outbound_intent_created',
        resourceType: 'client_webhook_outbox',
        resourceId: outboxRows[0].id,
        metadata: {
          onboardingId,
          eventType: 'onboarding.state_changed',
          status: 'pending',
          attempt: 0,
          payload: outboxRows[0].payload,
        },
      },
    );
    expectExactAuditRow(
      outboxAuditRows.find((row) => row.action === 'webhook.outbound_delivery_attempted'),
      {
        action: 'webhook.outbound_delivery_attempted',
        resourceType: 'client_webhook_outbox',
        resourceId: outboxRows[0].id,
        metadata: {
          onboardingId,
          eventType: 'onboarding.state_changed',
          attempt: 1,
          payload: outboxRows[0].payload,
        },
      },
    );
    expect(
      outboxAuditRows.find((row) => row.action === 'webhook.outbound_delivery_failed'),
    ).toBeUndefined();
  });

  it('persists outbound outbox audit rows for a successful delivery', async () => {
    const onboardingId = await seedAcceptedSubmitOnboarding();

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((result) => expect([200, 201]).toContain(result.status));

    const outboxRows = await readOutboxRows(onboardingId);
    expect(outboxRows).toHaveLength(1);
    await deliverOutbox(outboxRows[0].id);

    const auditRows = await readWebhookAuditRows(outboxRows[0].id);
    const outboxPayload = outboxRows[0].payload;
    expect(auditRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'webhook.outbound_intent_created',
          resource_type: 'client_webhook_outbox',
          metadata: {
            onboardingId,
            eventType: 'onboarding.state_changed',
            status: 'pending',
            attempt: 0,
            payload: outboxPayload,
          },
        }),
        expect.objectContaining({
          action: 'webhook.outbound_delivery_attempted',
          resource_type: 'client_webhook_outbox',
          metadata: {
            onboardingId,
            eventType: 'onboarding.state_changed',
            attempt: 1,
            payload: outboxPayload,
          },
        }),
        expect.objectContaining({
          action: 'webhook.outbound_delivery_succeeded',
          resource_type: 'client_webhook_outbox',
          metadata: {
            onboardingId,
            eventType: 'onboarding.state_changed',
            attempt: 1,
            status: 'delivered',
            payload: outboxPayload,
          },
        }),
      ]),
    );
  });

  it('persists inbound callback receipt and applied rows with safe metadata on valid callback persistence', async () => {
    const onboardingId = await seedCallbackOnboarding();
    const submittedData = createNestedSubmittedData(onboardingId);
    const callback = await prepareMockAsyncCallback(onboardingId, submittedData);

    await request(getApp().getHttpServer())
      .post('/v1/webhooks/mock_async_callback/callback')
      .set('content-type', 'application/json')
      .send(Buffer.from(callback.rawBody).toString('utf8'))
      .expect(204);

    const onboardingRows = await readOnboardingRows(onboardingId);
    expect(onboardingRows).toEqual([
      expect.objectContaining({
        id: onboardingId,
        workflow_id: 'base',
        workflow_version: 1,
        status: 'awaiting_user',
        current_step: 'accept_terms',
        completed_at: null,
      }),
    ]);

    const lifecycleRows = await readAuditRows(onboardingId);
    expect(lifecycleRows).toHaveLength(1);
    expect(lifecycleRows[0]).toEqual(
      expect.objectContaining({
        action: 'onboarding.state_transition',
        resource_type: 'onboarding',
        resource_id: onboardingId,
      }),
    );

    const inboundRows = await readInboundCallbackAuditRows();
    const receivedRow = inboundRows.find(
      (row) => row.action === 'webhook.inbound_callback_received',
    );
    expectExactAuditRow(receivedRow, {
      action: 'webhook.inbound_callback_received',
      resourceType: 'provider_callback',
      resourceId: UNRESOLVED_PROVIDER_CALLBACK_RESOURCE_ID,
      metadata: { ingress: 'provider_callback' },
    });
    expect(receivedRow?.metadata).not.toHaveProperty('rawBody');
    expect(receivedRow?.metadata).not.toHaveProperty('payload');

    const appliedRows = await readAppliedInboundAuditRows(onboardingId);
    expect(appliedRows).toHaveLength(1);
    expectExactAuditRow(appliedRows[0], {
      action: 'webhook.inbound_callback_applied',
      resourceType: 'onboarding',
      resourceId: onboardingId,
      metadata: {
        providerIdentity: 'mock_async_callback',
        connectorOrder: 1,
        submittedData,
        connectorExecutionResult: { status: 'accepted' },
        outcome: 'persisted',
      },
    });
    expect(appliedRows[0].metadata).not.toHaveProperty('rawBody');
    expect(appliedRows[0].metadata).not.toHaveProperty('payload');
  });

  it('projects rejected connector callback results into inbound applied audit metadata', async () => {
    const onboardingId = await seedCallbackOnboarding();
    const submittedData = createNestedSubmittedData(onboardingId);
    const callback = await prepareMockAsyncCallback(onboardingId, submittedData, {
      status: 'rejected',
      reason: 'CONNECTOR_REJECTED',
    });

    await request(getApp().getHttpServer())
      .post('/v1/webhooks/mock_async_callback/callback')
      .set('content-type', 'application/json')
      .send(Buffer.from(callback.rawBody).toString('utf8'))
      .expect(204);

    const appliedRows = await readAppliedInboundAuditRows(onboardingId);
    expectExactAuditRow(appliedRows[0], {
      action: 'webhook.inbound_callback_applied',
      resourceType: 'onboarding',
      resourceId: onboardingId,
      metadata: {
        providerIdentity: 'mock_async_callback',
        connectorOrder: 1,
        submittedData,
        connectorExecutionResult: {
          status: 'rejected',
          reason: 'CONNECTOR_REJECTED',
        },
        outcome: 'persisted',
      },
    });
    expect(appliedRows[0].metadata).not.toHaveProperty('rawBody');
    expect(appliedRows[0].metadata).not.toHaveProperty('payload');
  });

  it('records invalid-data connector callback rejections with the base workflow email field', async () => {
    const onboardingId = await seedCallbackOnboarding();
    const submittedData = createNestedSubmittedData(onboardingId);
    const callback = await prepareMockAsyncCallback(onboardingId, submittedData, {
      status: 'invalid-data',
      errors: {
        verificationCode: ['INVALID'],
      },
    });

    jest.restoreAllMocks();

    await request(getApp().getHttpServer())
      .post('/v1/webhooks/mock_async_callback/callback')
      .set('content-type', 'application/json')
      .send(Buffer.from(callback.rawBody).toString('utf8'))
      .expect(400);

    const onboardingRows = await readOnboardingRows(onboardingId);
    expect(onboardingRows).toEqual([
      expect.objectContaining({
        id: onboardingId,
        workflow_id: 'base',
        workflow_version: 1,
        status: 'awaiting_user',
        current_step: 'collect_email',
        context: {},
        completed_at: null,
      }),
    ]);

    expect(await readAppliedInboundAuditRows(onboardingId)).toHaveLength(0);

    await expectLatestRejectedAttemptAuditRow(onboardingId, {
      operation: 'submit',
      outcome: 'retryable_invalid_data',
    });
  });

  it('projects invalid connector callback results into inbound applied audit metadata', async () => {
    const onboardingId = await seedCallbackOnboarding();
    const submittedData = createNestedSubmittedData(onboardingId);
    const callback = await prepareMockAsyncCallback(onboardingId, submittedData, {
      status: 'invalid',
    });

    await request(getApp().getHttpServer())
      .post('/v1/webhooks/mock_async_callback/callback')
      .set('content-type', 'application/json')
      .send(Buffer.from(callback.rawBody).toString('utf8'))
      .expect(204);

    const appliedRows = await readAppliedInboundAuditRows(onboardingId);
    expectExactAuditRow(appliedRows[0], {
      action: 'webhook.inbound_callback_applied',
      resourceType: 'onboarding',
      resourceId: onboardingId,
      metadata: {
        providerIdentity: 'mock_async_callback',
        connectorOrder: 1,
        submittedData,
        connectorExecutionResult: {
          status: 'invalid',
        },
        outcome: 'persisted',
      },
    });
    expect(appliedRows[0].metadata).not.toHaveProperty('rawBody');
    expect(appliedRows[0].metadata).not.toHaveProperty('payload');
  });

  it('projects pending connector callback results and result metadata into inbound applied audit metadata', async () => {
    const onboardingId = await seedCallbackOnboarding();
    const connector = getApp().get(MockAsyncCallbackConnector);
    const submittedData = createNestedSubmittedData(onboardingId);
    const callback = await prepareMockAsyncCallback(onboardingId, submittedData);

    jest.spyOn(connector, 'mapCallbackResult').mockResolvedValueOnce({
      onboardingId,
      submittedData,
      resolvedConnector: {
        connectorOrder: 1,
      },
      result: ConnectorExecutionResult.pending({
        connectorName: 'mock_async_callback',
        connectorId: 'mock_async_callback',
        connectorOrder: 1,
      }),
    });

    await request(getApp().getHttpServer())
      .post('/v1/webhooks/mock_async_callback/callback')
      .set('content-type', 'application/json')
      .send(Buffer.from(callback.rawBody).toString('utf8'))
      .expect(204);

    const appliedRows = await readAppliedInboundAuditRows(onboardingId);
    expectExactAuditRow(appliedRows[0], {
      action: 'webhook.inbound_callback_applied',
      resourceType: 'onboarding',
      resourceId: onboardingId,
      metadata: {
        providerIdentity: 'mock_async_callback',
        connectorOrder: 1,
        submittedData,
        connectorExecutionResult: {
          status: 'pending',
          pending: {
            connectorName: 'mock_async_callback',
            connectorId: 'mock_async_callback',
            connectorOrder: 1,
          },
        },
        outcome: 'persisted',
      },
    });
    expect(appliedRows[0].metadata).not.toHaveProperty('rawBody');
    expect(appliedRows[0].metadata).not.toHaveProperty('payload');
  });

  it('projects connector result metadata into inbound applied audit metadata', async () => {
    const onboardingId = await seedCallbackOnboarding();
    const connector = getApp().get(MockAsyncCallbackConnector);
    const submittedData = createNestedSubmittedData(onboardingId);
    const callback = await prepareMockAsyncCallback(onboardingId, submittedData);

    jest.spyOn(connector, 'mapCallbackResult').mockResolvedValueOnce({
      onboardingId,
      submittedData,
      resolvedConnector: {
        connectorOrder: 1,
      },
      result: ConnectorExecutionResult.accepted({
        connectorTrace: 'trace-12345',
        connectorId: 'mock_async_callback',
      }),
    });

    await request(getApp().getHttpServer())
      .post('/v1/webhooks/mock_async_callback/callback')
      .set('content-type', 'application/json')
      .send(Buffer.from(callback.rawBody).toString('utf8'))
      .expect(204);

    const appliedRows = await readAppliedInboundAuditRows(onboardingId);
    expectExactAuditRow(appliedRows[0], {
      action: 'webhook.inbound_callback_applied',
      resourceType: 'onboarding',
      resourceId: onboardingId,
      metadata: {
        providerIdentity: 'mock_async_callback',
        connectorOrder: 1,
        submittedData,
        connectorExecutionResult: {
          status: 'accepted',
          metadata: {
            connectorTrace: 'trace-12345',
            connectorId: 'mock_async_callback',
          },
        },
        outcome: 'persisted',
      },
    });
    expect(appliedRows[0].metadata).not.toHaveProperty('rawBody');
    expect(appliedRows[0].metadata).not.toHaveProperty('payload');
  });

  it('records malformed callback body rejection with unresolved provider identity', async () => {
    await request(getApp().getHttpServer())
      .post('/v1/webhooks/mock_async_callback/callback')
      .set('x-test-force-raw-body-rejection', '1')
      .set('content-type', 'application/json')
      .send(Buffer.from('ignored'))
      .expect(400)
      .expect({
        code: 'ASYNC_CALLBACK_RAW_BODY_REQUIRED',
        message: 'ASYNC_CALLBACK_RAW_BODY_REQUIRED',
      });

    const inboundRows = await readInboundCallbackAuditRows();
    const rejectedRow = inboundRows.find(
      (row) => row.action === 'webhook.inbound_callback_rejected',
    );
    expectExactAuditRow(rejectedRow, {
      action: 'webhook.inbound_callback_rejected',
      resourceType: 'provider_callback',
      resourceId: UNRESOLVED_PROVIDER_CALLBACK_RESOURCE_ID,
      metadata: { reason: 'raw_body_required' },
    });
    expect(rejectedRow?.metadata).not.toHaveProperty('rawBody');
    expect(rejectedRow?.metadata).not.toHaveProperty('payload');
  });

  it('records invalid provider-key rejection with unresolved provider identity', async () => {
    await request(getApp().getHttpServer())
      .post('/v1/webhooks/MOCK-ASYNC-CALLBACK/callback')
      .set('content-type', 'application/json')
      .send(Buffer.from('{"providerReference":"x","submittedData":{}}'))
      .expect(400)
      .expect({
        code: 'ASYNC_CALLBACK_PROVIDER_KEY_INVALID',
        message: 'ASYNC_CALLBACK_PROVIDER_KEY_INVALID',
      });

    const inboundRows = await readInboundCallbackAuditRows();
    const rejectedRow = inboundRows.find(
      (row) => row.action === 'webhook.inbound_callback_rejected',
    );
    expectExactAuditRow(rejectedRow, {
      action: 'webhook.inbound_callback_rejected',
      resourceType: 'provider_callback',
      resourceId: UNRESOLVED_PROVIDER_CALLBACK_RESOURCE_ID,
      metadata: { reason: 'provider_key_invalid' },
    });
    expect(rejectedRow?.metadata).not.toHaveProperty('rawBody');
    expect(rejectedRow?.metadata).not.toHaveProperty('payload');
  });

  it('records authentication-failed callback rejection with the received inbound callback row', async () => {
    const connectorExecutionPort = getApp().get(WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT) as {
      findAdapterById: (providerKey: string) => unknown;
    };

    jest.spyOn(connectorExecutionPort, 'findAdapterById').mockImplementation(() => {
      throw new Error('missing adapter');
    });

    await request(getApp().getHttpServer())
      .post('/v1/webhooks/mock_async_callback/callback')
      .set('content-type', 'application/json')
      .send(Buffer.from('{"providerReference":"x","submittedData":{}}'))
      .expect(400)
      .expect({
        code: 'ASYNC_CALLBACK_AUTHENTICATION_FAILED',
        message: 'ASYNC_CALLBACK_AUTHENTICATION_FAILED',
      });

    const inboundRows = await readInboundCallbackAuditRows();
    const receivedRow = inboundRows.find(
      (row) => row.action === 'webhook.inbound_callback_received',
    );
    const rejectedRow = inboundRows.find(
      (row) => row.action === 'webhook.inbound_callback_rejected',
    );

    expectExactAuditRow(receivedRow, {
      action: 'webhook.inbound_callback_received',
      resourceType: 'provider_callback',
      resourceId: UNRESOLVED_PROVIDER_CALLBACK_RESOURCE_ID,
      metadata: { ingress: 'provider_callback' },
    });
    expect(receivedRow?.metadata).not.toHaveProperty('rawBody');
    expect(receivedRow?.metadata).not.toHaveProperty('payload');

    expectExactAuditRow(rejectedRow, {
      action: 'webhook.inbound_callback_rejected',
      resourceType: 'provider_callback',
      resourceId: UNRESOLVED_PROVIDER_CALLBACK_RESOURCE_ID,
      metadata: { reason: 'authentication_failed' },
    });
    expect(rejectedRow?.metadata).not.toHaveProperty('rawBody');
    expect(rejectedRow?.metadata).not.toHaveProperty('payload');
  });

  it('records inbound callback mapping failures against the resolved provider identity', async () => {
    const onboardingId = await seedCallbackOnboarding();
    const connector = getApp().get(MockAsyncCallbackConnector);
    const submittedData = createNestedSubmittedData(onboardingId);
    const callback = await prepareMockAsyncCallback(onboardingId, submittedData);

    jest.spyOn(connector, 'mapCallbackResult').mockRejectedValueOnce(new Error('mapping blew up'));

    await request(getApp().getHttpServer())
      .post('/v1/webhooks/mock_async_callback/callback')
      .set('content-type', 'application/json')
      .send(Buffer.from(callback.rawBody).toString('utf8'))
      .expect(500);

    const inboundRows = await readInboundCallbackAuditRows();
    expectExactAuditRow(
      inboundRows.find(
        (row) =>
          row.action === 'webhook.inbound_callback_received' &&
          row.resource_id === UNRESOLVED_PROVIDER_CALLBACK_RESOURCE_ID,
      ),
      {
        action: 'webhook.inbound_callback_received',
        resourceType: 'provider_callback',
        resourceId: UNRESOLVED_PROVIDER_CALLBACK_RESOURCE_ID,
        metadata: { ingress: 'provider_callback' },
      },
    );
    expect(
      inboundRows.find(
        (row) =>
          row.action === 'webhook.inbound_callback_received' &&
          row.resource_id === UNRESOLVED_PROVIDER_CALLBACK_RESOURCE_ID,
      )?.metadata,
    ).not.toHaveProperty('rawBody');
    expect(
      inboundRows.find(
        (row) =>
          row.action === 'webhook.inbound_callback_received' &&
          row.resource_id === UNRESOLVED_PROVIDER_CALLBACK_RESOURCE_ID,
      )?.metadata,
    ).not.toHaveProperty('payload');

    const mappedRows = await readInboundCallbackAuditRows('mock_async_callback');
    expectExactAuditRow(
      mappedRows.find((row) => row.action === 'webhook.inbound_callback_mapping_failed'),
      {
        action: 'webhook.inbound_callback_mapping_failed',
        resourceType: 'provider_callback',
        resourceId: 'mock_async_callback',
        metadata: { reason: 'mapping_failed' },
      },
    );
    expect(
      mappedRows.find((row) => row.action === 'webhook.inbound_callback_mapping_failed')?.metadata,
    ).not.toHaveProperty('rawBody');
    expect(
      mappedRows.find((row) => row.action === 'webhook.inbound_callback_mapping_failed')?.metadata,
    ).not.toHaveProperty('payload');
  });

  it('rolls back onboarding and audit persistence when inbound callback applied audit write fails', async () => {
    const onboardingId = await seedCallbackOnboarding();
    const callback = await prepareMockAsyncCallback(
      onboardingId,
      createNestedSubmittedData(onboardingId),
    );
    const auditService = getApp().get(AuditService);
    const webhookService = getApp().get(WebhookService);
    const originalLogWebhook = auditService.logWebhook.bind(auditService);

    jest.spyOn(auditService, 'logWebhook').mockImplementation(async (manager, input) => {
      if (input.action === 'webhook.inbound_callback_applied') {
        throw new Error('forced applied audit failure');
      }

      return originalLogWebhook(manager, input);
    });
    jest.spyOn(webhookService, 'notifyError').mockResolvedValue(undefined);

    await request(getApp().getHttpServer())
      .post('/v1/webhooks/mock_async_callback/callback')
      .set('content-type', 'application/json')
      .send(Buffer.from(callback.rawBody).toString('utf8'))
      .expect(500);

    const onboardingRows = await readOnboardingRows(onboardingId);
    expect(onboardingRows).toEqual([
      expect.objectContaining({
        id: onboardingId,
        workflow_id: 'base',
        workflow_version: 1,
        status: 'awaiting_user',
        current_step: 'collect_email',
        context: {},
        completed_at: null,
      }),
    ]);

    const lifecycleRows = await readAuditRows(onboardingId);
    expect(lifecycleRows).toHaveLength(0);

    const appliedRows = await readAppliedInboundAuditRows(onboardingId);
    expect(appliedRows).toHaveLength(0);

    const outboxRows = await readOutboxRows(onboardingId);
    expect(outboxRows).toHaveLength(0);
  });

  it('covers the lifecycle audit matrix and rejected-attempt mappings across real routes', async () => {
    const baseInitialStep = 'collect_email';
    const acceptTermsStep = 'accept_terms';
    const manualReviewStep = 'awaiting_manual_review';

    const startOnboardingId = await startWorkflowOnboarding(
      'base',
      baseInitialStep,
      'awaiting_user',
    );
    await expectLifecycleAuditRows(startOnboardingId, [
      {
        action: 'onboarding.started',
        before: null,
        after: {
          id: startOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: baseInitialStep,
          scores: {},
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: null,
          fromStatus: null,
          fromCurrentStep: null,
          toStatus: 'awaiting_user',
          toCurrentStep: baseInitialStep,
          fromScores: null,
          toScores: {},
        },
      },
    ]);

    const intermediateOnboardingId = await startWorkflowOnboarding(
      'base',
      baseInitialStep,
      'awaiting_user',
    );
    const intermediateResponse = await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${intermediateOnboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect((result) => expect([200, 201]).toContain(result.status));

    expect(intermediateResponse.body).toEqual({
      appliedStep: baseInitialStep,
      status: 'awaiting_user',
      currentStep: acceptTermsStep,
      rejectionReason: null,
    });

    await expectLifecycleAuditRows(intermediateOnboardingId, [
      {
        action: 'onboarding.state_transition',
        before: {
          id: intermediateOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: baseInitialStep,
          scores: {},
        },
        after: {
          id: intermediateOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: acceptTermsStep,
          scores: {},
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: baseInitialStep,
          fromStatus: 'awaiting_user',
          toStatus: 'awaiting_user',
          fromCurrentStep: baseInitialStep,
          toCurrentStep: acceptTermsStep,
          fromScores: {},
          toScores: {},
        },
      },
      {
        action: 'onboarding.started',
        before: null,
        after: {
          id: intermediateOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: baseInitialStep,
          scores: {},
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: null,
          fromStatus: null,
          fromCurrentStep: null,
          toStatus: 'awaiting_user',
          toCurrentStep: baseInitialStep,
          fromScores: null,
          toScores: {},
        },
      },
    ]);

    const approvedOnboardingId = await startWorkflowOnboarding(
      'base',
      baseInitialStep,
      'awaiting_user',
    );
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${approvedOnboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect((result) => expect([200, 201]).toContain(result.status));

    const approvedResponse = await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${approvedOnboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((result) => expect([200, 201]).toContain(result.status));

    expect(approvedResponse.body).toEqual({
      appliedStep: acceptTermsStep,
      status: 'approved',
      currentStep: null,
      rejectionReason: null,
    });

    await expectLifecycleAuditRows(approvedOnboardingId, [
      {
        action: 'onboarding.state_transition',
        before: {
          id: approvedOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: acceptTermsStep,
          scores: {},
        },
        after: {
          id: approvedOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'approved',
          currentStep: null,
          scores: {},
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: acceptTermsStep,
          fromStatus: 'awaiting_user',
          toStatus: 'approved',
          fromCurrentStep: acceptTermsStep,
          toCurrentStep: null,
          fromScores: {},
          toScores: {},
        },
      },
      {
        action: 'onboarding.state_transition',
        before: {
          id: approvedOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: baseInitialStep,
          scores: {},
        },
        after: {
          id: approvedOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: acceptTermsStep,
          scores: {},
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: baseInitialStep,
          fromStatus: 'awaiting_user',
          toStatus: 'awaiting_user',
          fromCurrentStep: baseInitialStep,
          toCurrentStep: acceptTermsStep,
          fromScores: {},
          toScores: {},
        },
      },
      {
        action: 'onboarding.started',
        before: null,
        after: {
          id: approvedOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: baseInitialStep,
          scores: {},
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: null,
          fromStatus: null,
          fromCurrentStep: null,
          toStatus: 'awaiting_user',
          toCurrentStep: baseInitialStep,
          fromScores: null,
          toScores: {},
        },
      },
    ]);

    const rejectedOnboardingId = await startWorkflowOnboarding(
      'twilio-verify',
      'request_code',
      'awaiting_user',
    );
    const twilioVerifyMockForRejected = getApp().get(MockPhoneVerificationConnector);
    twilioVerifyMockForRejected.__resetForTests();

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${rejectedOnboardingId}/submit`)
      .send({ phoneNumber: TWILIO_PHONE_NUMBER })
      .expect((result) => expect([200, 201]).toContain(result.status));

    const isLifecycleOrRejectedAttemptRow = (row: AuditLogRow) =>
      isAuditAction(ONBOARDING_TRANSITION_ACTIONS, row.action) ||
      row.action === ONBOARDING_REJECTED_ATTEMPT_ACTION;

    const rejectedRowsBaseline = (
      (await readAuditRows(rejectedOnboardingId)) as AuditLogRow[]
    ).filter(isLifecycleOrRejectedAttemptRow);

    for (let attempt = 1; attempt < TWILIO_MAX_ATTEMPTS; attempt += 1) {
      await request(getApp().getHttpServer())
        .post(`/v1/onboardings/${rejectedOnboardingId}/submit`)
        .send({ verificationCode: String(attempt).repeat(6) })
        .expect(400)
        .expect({
          code: 'INVALID_STEP_DATA',
          message: 'INVALID_STEP_DATA',
          errors: { verificationCode: ['INVALID'] },
        });
    }

    const rejectedResponse = await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${rejectedOnboardingId}/submit`)
      .send({ verificationCode: '999999' })
      .expect((result) => expect([200, 201]).toContain(result.status));

    expect(rejectedResponse.body).toEqual({
      appliedStep: 'verify_code',
      status: 'rejected',
      currentStep: null,
      rejectionReason: 'ATTEMPTS_EXHAUSTED',
    });

    const rejectedRowsAfterAllAttempts = (
      (await readAuditRows(rejectedOnboardingId)) as AuditLogRow[]
    ).filter(isLifecycleOrRejectedAttemptRow);
    const retryableInvalidAttemptRows = rejectedRowsAfterAllAttempts.filter(
      (row) =>
        row.action === 'onboarding.rejected_attempt' &&
        row.metadata.operation === 'submit' &&
        row.metadata.outcome === 'retryable_invalid_data',
    );

    expect(rejectedRowsAfterAllAttempts).toHaveLength(
      rejectedRowsBaseline.length + TWILIO_MAX_ATTEMPTS,
    );
    expect(retryableInvalidAttemptRows).toHaveLength(TWILIO_MAX_ATTEMPTS - 1);

    await expectLifecycleAuditRows(
      rejectedOnboardingId,
      [
        {
          action: 'onboarding.state_transition',
          before: {
            id: rejectedOnboardingId,
            workflowId: 'twilio-verify',
            workflowVersion: 1,
            status: 'awaiting_user',
            currentStep: 'verify_code',
            scores: {},
          },
          after: {
            id: rejectedOnboardingId,
            workflowId: 'twilio-verify',
            workflowVersion: 1,
            status: 'rejected',
            currentStep: null,
            scores: {},
          },
          metadata: {
            workflowId: 'twilio-verify',
            workflowVersion: 1,
            appliedStep: 'verify_code',
            fromStatus: 'awaiting_user',
            toStatus: 'rejected',
            fromCurrentStep: 'verify_code',
            toCurrentStep: null,
            fromScores: {},
            toScores: {},
          },
        },
        {
          action: 'onboarding.state_transition',
          before: {
            id: rejectedOnboardingId,
            workflowId: 'twilio-verify',
            workflowVersion: 1,
            status: 'awaiting_user',
            currentStep: 'request_code',
            scores: {},
          },
          after: {
            id: rejectedOnboardingId,
            workflowId: 'twilio-verify',
            workflowVersion: 1,
            status: 'awaiting_user',
            currentStep: 'verify_code',
            scores: {},
          },
          metadata: {
            workflowId: 'twilio-verify',
            workflowVersion: 1,
            appliedStep: 'request_code',
            fromStatus: 'awaiting_user',
            toStatus: 'awaiting_user',
            fromCurrentStep: 'request_code',
            toCurrentStep: 'verify_code',
            fromScores: {},
            toScores: {},
          },
        },
        {
          action: 'onboarding.started',
          before: null,
          after: {
            id: rejectedOnboardingId,
            workflowId: 'twilio-verify',
            workflowVersion: 1,
            status: 'awaiting_user',
            currentStep: 'request_code',
            scores: {},
          },
          metadata: {
            workflowId: 'twilio-verify',
            workflowVersion: 1,
            appliedStep: null,
            fromStatus: null,
            fromCurrentStep: null,
            toStatus: 'awaiting_user',
            toCurrentStep: 'request_code',
            fromScores: null,
            toScores: {},
          },
        },
      ],
      { lifecycleOnly: true },
    );

    const terminalInvalidOnboardingId = await startWorkflowOnboarding(
      'base',
      baseInitialStep,
      'awaiting_user',
    );
    await dataSource().query(
      `UPDATE onboardings
       SET current_step = $2
       WHERE id = $1`,
      [terminalInvalidOnboardingId, 'missing_step'],
    );
    const terminalInvalidResponse = await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${terminalInvalidOnboardingId}/submit`)
      .send({ email: 'not-an-email' })
      .expect((result) => expect([200, 201]).toContain(result.status));

    expect(terminalInvalidResponse.body).toEqual({
      appliedStep: null,
      status: 'invalid',
      currentStep: null,
      rejectionReason: null,
    });

    await expectLifecycleAuditRows(terminalInvalidOnboardingId, [
      {
        action: 'onboarding.state_transition',
        before: {
          id: terminalInvalidOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: 'missing_step',
          scores: {},
        },
        after: {
          id: terminalInvalidOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'invalid',
          currentStep: null,
          scores: {},
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: null,
          fromStatus: 'awaiting_user',
          toStatus: 'invalid',
          fromCurrentStep: 'missing_step',
          toCurrentStep: null,
          fromScores: {},
          toScores: {},
        },
      },
      {
        action: 'onboarding.started',
        before: null,
        after: {
          id: terminalInvalidOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: baseInitialStep,
          scores: {},
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: null,
          fromStatus: null,
          fromCurrentStep: null,
          toStatus: 'awaiting_user',
          toCurrentStep: baseInitialStep,
          fromScores: null,
          toScores: {},
        },
      },
    ]);

    const manualApprovedOnboardingId = await startWorkflowOnboarding(
      'manual-review',
      manualReviewStep,
      'awaiting_manual_review',
    );

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${manualApprovedOnboardingId}/review/approve`)
      .expect(200)
      .expect({ appliedStep: manualReviewStep, status: 'approved', currentStep: null });

    await expectLifecycleAuditRows(manualApprovedOnboardingId, [
      {
        action: 'onboarding.manual_review_decision',
        before: {
          id: manualApprovedOnboardingId,
          workflowId: 'manual-review',
          workflowVersion: 1,
          status: 'awaiting_manual_review',
          currentStep: manualReviewStep,
          scores: {},
        },
        after: {
          id: manualApprovedOnboardingId,
          workflowId: 'manual-review',
          workflowVersion: 1,
          status: 'approved',
          currentStep: null,
          scores: {},
        },
        metadata: {
          workflowId: 'manual-review',
          workflowVersion: 1,
          manualTrigger: 'manual.approve',
          appliedStep: manualReviewStep,
          fromStatus: 'awaiting_manual_review',
          toStatus: 'approved',
          fromCurrentStep: manualReviewStep,
          toCurrentStep: null,
          fromScores: {},
          toScores: {},
        },
      },
      {
        action: 'onboarding.started',
        before: null,
        after: {
          id: manualApprovedOnboardingId,
          workflowId: 'manual-review',
          workflowVersion: 1,
          status: 'awaiting_manual_review',
          currentStep: manualReviewStep,
          scores: {},
        },
        metadata: {
          workflowId: 'manual-review',
          workflowVersion: 1,
          appliedStep: null,
          fromStatus: null,
          fromCurrentStep: null,
          toStatus: 'awaiting_manual_review',
          toCurrentStep: manualReviewStep,
          fromScores: null,
          toScores: {},
        },
      },
    ]);

    const manualRejectedOnboardingId = await startWorkflowOnboarding(
      'manual-review',
      manualReviewStep,
      'awaiting_manual_review',
    );

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${manualRejectedOnboardingId}/review/reject`)
      .expect(200)
      .expect({ appliedStep: manualReviewStep, status: 'rejected', currentStep: null });

    await expectLifecycleAuditRows(manualRejectedOnboardingId, [
      {
        action: 'onboarding.manual_review_decision',
        before: {
          id: manualRejectedOnboardingId,
          workflowId: 'manual-review',
          workflowVersion: 1,
          status: 'awaiting_manual_review',
          currentStep: manualReviewStep,
          scores: {},
        },
        after: {
          id: manualRejectedOnboardingId,
          workflowId: 'manual-review',
          workflowVersion: 1,
          status: 'rejected',
          currentStep: null,
          scores: {},
        },
        metadata: {
          workflowId: 'manual-review',
          workflowVersion: 1,
          manualTrigger: 'manual.reject',
          appliedStep: manualReviewStep,
          fromStatus: 'awaiting_manual_review',
          toStatus: 'rejected',
          fromCurrentStep: manualReviewStep,
          toCurrentStep: null,
          fromScores: {},
          toScores: {},
        },
      },
      {
        action: 'onboarding.started',
        before: null,
        after: {
          id: manualRejectedOnboardingId,
          workflowId: 'manual-review',
          workflowVersion: 1,
          status: 'awaiting_manual_review',
          currentStep: manualReviewStep,
          scores: {},
        },
        metadata: {
          workflowId: 'manual-review',
          workflowVersion: 1,
          appliedStep: null,
          fromStatus: null,
          fromCurrentStep: null,
          toStatus: 'awaiting_manual_review',
          toCurrentStep: manualReviewStep,
          fromScores: null,
          toScores: {},
        },
      },
    ]);

    const manualInvalidOnboardingId = await startWorkflowOnboarding(
      'manual-review',
      manualReviewStep,
      'awaiting_manual_review',
    );

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${manualInvalidOnboardingId}/review/invalid`)
      .expect(200)
      .expect({ appliedStep: manualReviewStep, status: 'invalid', currentStep: null });

    await expectLifecycleAuditRows(manualInvalidOnboardingId, [
      {
        action: 'onboarding.manual_review_decision',
        before: {
          id: manualInvalidOnboardingId,
          workflowId: 'manual-review',
          workflowVersion: 1,
          status: 'awaiting_manual_review',
          currentStep: manualReviewStep,
          scores: {},
        },
        after: {
          id: manualInvalidOnboardingId,
          workflowId: 'manual-review',
          workflowVersion: 1,
          status: 'invalid',
          currentStep: null,
          scores: {},
        },
        metadata: {
          workflowId: 'manual-review',
          workflowVersion: 1,
          manualTrigger: 'manual.invalid',
          appliedStep: manualReviewStep,
          fromStatus: 'awaiting_manual_review',
          toStatus: 'invalid',
          fromCurrentStep: manualReviewStep,
          toCurrentStep: null,
          fromScores: {},
          toScores: {},
        },
      },
      {
        action: 'onboarding.started',
        before: null,
        after: {
          id: manualInvalidOnboardingId,
          workflowId: 'manual-review',
          workflowVersion: 1,
          status: 'awaiting_manual_review',
          currentStep: manualReviewStep,
          scores: {},
        },
        metadata: {
          workflowId: 'manual-review',
          workflowVersion: 1,
          appliedStep: null,
          fromStatus: null,
          fromCurrentStep: null,
          toStatus: 'awaiting_manual_review',
          toCurrentStep: manualReviewStep,
          fromScores: null,
          toScores: {},
        },
      },
    ]);

    const retryableInvalidOnboardingId = await startWorkflowOnboarding(
      'twilio-verify',
      'request_code',
      'awaiting_user',
    );
    const twilioVerifyMockForRetryableInvalid = getApp().get(MockPhoneVerificationConnector);
    twilioVerifyMockForRetryableInvalid.__resetForTests();

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${retryableInvalidOnboardingId}/submit`)
      .send({ phoneNumber: TWILIO_PHONE_NUMBER })
      .expect((result) => expect([200, 201]).toContain(result.status));

    const retryableRowsBefore = (
      (await readAuditRows(retryableInvalidOnboardingId)) as AuditLogRow[]
    ).filter(isLifecycleOrRejectedAttemptRow);
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${retryableInvalidOnboardingId}/submit`)
      .send({ verificationCode: '000000' })
      .expect(400)
      .expect({
        code: 'INVALID_STEP_DATA',
        message: 'INVALID_STEP_DATA',
        errors: { verificationCode: ['INVALID'] },
      });
    const retryableRowsAfter = (
      await expectLatestRejectedAttemptAuditRow(retryableInvalidOnboardingId, {
        operation: 'submit',
        outcome: 'retryable_invalid_data',
      })
    ).filter(isLifecycleOrRejectedAttemptRow);
    expect(retryableRowsAfter).toHaveLength(retryableRowsBefore.length + 1);

    const submitUnknownEvaluationOnboardingId = await startWorkflowOnboarding(
      'base',
      baseInitialStep,
      'awaiting_user',
    );
    const submitUnknownWorkflow = await pinWorkflowInstance('base', 1);
    const evaluateSpy = jest
      .spyOn(submitUnknownWorkflow, 'evaluate')
      .mockResolvedValue(WorkflowEvaluationResult.unknownEvaluation());

    try {
      const submitUnknownRowsBefore = await readAuditRows(submitUnknownEvaluationOnboardingId);

      await request(getApp().getHttpServer())
        .post(`/v1/onboardings/${submitUnknownEvaluationOnboardingId}/submit`)
        .send({ email: 'person@example.com' })
        .expect(409)
        .expect({ code: 'UNKNOWN_WORKFLOW_EVALUATION', message: 'UNKNOWN_WORKFLOW_EVALUATION' });

      const submitUnknownRowsAfter = await expectLatestRejectedAttemptAuditRow(
        submitUnknownEvaluationOnboardingId,
        {
          operation: 'submit',
          outcome: 'unknown_workflow_evaluation',
        },
      );
      expect(submitUnknownRowsAfter).toHaveLength(submitUnknownRowsBefore.length + 1);
    } finally {
      evaluateSpy.mockRestore();
    }

    const submitCompletedConflictOnboardingId = await startWorkflowOnboarding(
      'base',
      baseInitialStep,
      'awaiting_user',
    );
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${submitCompletedConflictOnboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect((result) => expect([200, 201]).toContain(result.status));
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${submitCompletedConflictOnboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((result) => expect([200, 201]).toContain(result.status));

    const submitCompletedRowsBefore = await readAuditRows(submitCompletedConflictOnboardingId);
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${submitCompletedConflictOnboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect(409)
      .expect({ code: 'ONBOARDING_COMPLETED', message: 'ONBOARDING_COMPLETED' });
    const submitCompletedRowsAfter = await expectLatestRejectedAttemptAuditRow(
      submitCompletedConflictOnboardingId,
      {
        operation: 'submit',
        outcome: 'onboarding_completed',
      },
    );
    expect(submitCompletedRowsAfter).toHaveLength(submitCompletedRowsBefore.length + 1);

    const missingSubmitOnboardingId = '01900000-0000-7000-8000-000000000011';
    const missingSubmitRowsBefore = await readAuditRows(missingSubmitOnboardingId);
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${missingSubmitOnboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect(404)
      .expect({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' });
    const missingSubmitRowsAfterFirstAttempt = await expectLatestRejectedAttemptAuditRow(
      missingSubmitOnboardingId,
      {
        operation: 'submit',
        outcome: 'onboarding_not_found',
      },
    );
    expect(missingSubmitRowsAfterFirstAttempt).toHaveLength(missingSubmitRowsBefore.length + 1);

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${missingSubmitOnboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect(404)
      .expect({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' });
    const missingSubmitRowsAfterSecondAttempt = await expectLatestRejectedAttemptAuditRow(
      missingSubmitOnboardingId,
      {
        operation: 'submit',
        outcome: 'onboarding_not_found',
      },
    );
    expect(missingSubmitRowsAfterSecondAttempt).toHaveLength(missingSubmitRowsBefore.length + 2);

    const unknownEvaluationOnboardingId = await startWorkflowOnboarding(
      'manual-review',
      manualReviewStep,
      'awaiting_manual_review',
    );
    const unknownEvaluationWorkflow = await pinWorkflowInstance('manual-review', 1);
    const evaluateManualSpy = jest
      .spyOn(unknownEvaluationWorkflow, 'evaluateManual')
      .mockReturnValue(WorkflowEvaluationResult.unknownEvaluation());

    try {
      const unknownRowsBefore = await readAuditRows(unknownEvaluationOnboardingId);

      await request(getApp().getHttpServer())
        .post(`/v1/onboardings/${unknownEvaluationOnboardingId}/review/approve`)
        .expect(409)
        .expect({ code: 'UNKNOWN_WORKFLOW_EVALUATION', message: 'UNKNOWN_WORKFLOW_EVALUATION' });

      const unknownRowsAfter = await expectLatestRejectedAttemptAuditRow(
        unknownEvaluationOnboardingId,
        {
          operation: 'manual_review',
          outcome: 'unknown_workflow_evaluation',
        },
      );
      expect(unknownRowsAfter).toHaveLength(unknownRowsBefore.length + 1);
    } finally {
      evaluateManualSpy.mockRestore();
    }

    const unsupportedManualTransitionOnboardingId = await startWorkflowOnboarding(
      'manual-review',
      manualReviewStep,
      'awaiting_manual_review',
    );
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${unsupportedManualTransitionOnboardingId}/review/return`)
      .expect(400)
      .expect({
        message: ['action must be one of the following values: approve, reject, invalid'],
        error: 'Bad Request',
        statusCode: 400,
      });

    const unavailableManualTransitionOnboardingId = await startWorkflowOnboarding(
      'base',
      baseInitialStep,
      'awaiting_user',
    );
    const unavailableRowsBefore = await readAuditRows(unavailableManualTransitionOnboardingId);
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${unavailableManualTransitionOnboardingId}/review/approve`)
      .expect(409)
      .expect({
        code: 'MANUAL_TRANSITION_NOT_AVAILABLE',
        message: 'MANUAL_TRANSITION_NOT_AVAILABLE',
      });
    const unavailableRowsAfter = await expectLatestRejectedAttemptAuditRow(
      unavailableManualTransitionOnboardingId,
      {
        operation: 'manual_review',
        outcome: 'transition_unavailable',
      },
    );
    expect(unavailableRowsAfter).toHaveLength(unavailableRowsBefore.length + 1);

    const completedConflictOnboardingId = await startWorkflowOnboarding(
      'manual-review',
      manualReviewStep,
      'awaiting_manual_review',
    );
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${completedConflictOnboardingId}/review/approve`)
      .expect(200);

    const completedRowsBefore = await readAuditRows(completedConflictOnboardingId);
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${completedConflictOnboardingId}/review/reject`)
      .expect(409)
      .expect({ code: 'ONBOARDING_COMPLETED', message: 'ONBOARDING_COMPLETED' });
    const completedRowsAfter = await expectLatestRejectedAttemptAuditRow(
      completedConflictOnboardingId,
      {
        operation: 'manual_review',
        outcome: 'onboarding_completed',
      },
    );
    expect(completedRowsAfter).toHaveLength(completedRowsBefore.length + 1);

    const notFoundResourceId = '01900000-0000-7000-8000-000000000000';
    const notFoundRowsBefore = await readAuditRows(notFoundResourceId);
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${notFoundResourceId}/review/approve`)
      .expect(404)
      .expect({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' });
    const notFoundRowsAfter = await expectLatestRejectedAttemptAuditRow(notFoundResourceId, {
      operation: 'manual_review',
      outcome: 'onboarding_not_found',
    });
    expect(notFoundRowsAfter).toHaveLength(notFoundRowsBefore.length + 1);

    const notificationFailureOnboardingId = await startWorkflowOnboarding(
      'base',
      baseInitialStep,
      'awaiting_user',
    );
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${notificationFailureOnboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect((result) => expect([200, 201]).toContain(result.status));

    const notificationFailureRowsBefore = await readAuditRows(notificationFailureOnboardingId);
    webhookResponseMode = 'failure';

    const notificationFailureResponse = await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${notificationFailureOnboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((result) => expect([200, 201]).toContain(result.status));

    expect(notificationFailureResponse.body).toEqual({
      appliedStep: acceptTermsStep,
      status: 'approved',
      currentStep: null,
      rejectionReason: null,
    });

    await expectLifecycleAuditRows(notificationFailureOnboardingId, [
      {
        action: 'onboarding.state_transition',
        before: {
          id: notificationFailureOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: acceptTermsStep,
          scores: {},
        },
        after: {
          id: notificationFailureOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'approved',
          currentStep: null,
          scores: {},
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: acceptTermsStep,
          fromStatus: 'awaiting_user',
          toStatus: 'approved',
          fromCurrentStep: acceptTermsStep,
          toCurrentStep: null,
          fromScores: {},
          toScores: {},
        },
      },
      {
        action: 'onboarding.state_transition',
        before: {
          id: notificationFailureOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: baseInitialStep,
          scores: {},
        },
        after: {
          id: notificationFailureOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: acceptTermsStep,
          scores: {},
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: baseInitialStep,
          fromStatus: 'awaiting_user',
          toStatus: 'awaiting_user',
          fromCurrentStep: baseInitialStep,
          toCurrentStep: acceptTermsStep,
          fromScores: {},
          toScores: {},
        },
      },
      {
        action: 'onboarding.started',
        before: null,
        after: {
          id: notificationFailureOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: baseInitialStep,
          scores: {},
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: null,
          fromStatus: null,
          fromCurrentStep: null,
          toStatus: 'awaiting_user',
          toCurrentStep: baseInitialStep,
          fromScores: null,
          toScores: {},
        },
      },
    ]);

    expect(await readAuditRows(notificationFailureOnboardingId)).toHaveLength(
      notificationFailureRowsBefore.length + 1,
    );

    const notificationFailureOutboxRows = await readOutboxRows(notificationFailureOnboardingId);
    expect(notificationFailureOutboxRows).toHaveLength(2);
    await expect(deliverOutbox(notificationFailureOutboxRows[1].id)).rejects.toThrow();

    const notificationFailureWebhookRows = await readWebhookAuditRows(
      notificationFailureOutboxRows[1].id,
    );
    expectExactAuditRow(
      notificationFailureWebhookRows.find(
        (row) => row.action === 'webhook.outbound_delivery_failed',
      ),
      {
        action: 'webhook.outbound_delivery_failed',
        resourceType: 'client_webhook_outbox',
        resourceId: notificationFailureOutboxRows[1].id,
        metadata: {
          onboardingId: notificationFailureOnboardingId,
          eventType: 'onboarding.state_changed',
          attempt: 1,
          status: 'pending',
          reason: 'delivery_failed',
          payload: notificationFailureOutboxRows[1].payload,
        },
      },
    );
  });

  it('records outbound notification suppression when the workflow has no configured notify webhook', async () => {
    const workflow = await pinWorkflowInstance('base', 1);
    const getRootNotifyWebhookSpy = jest.spyOn(workflow, 'getRootNotifyWebhook');
    getRootNotifyWebhookSpy.mockReturnValue(undefined);

    try {
      const response = await request(getApp().getHttpServer())
        .post('/v1/onboardings')
        .send({ workflowId: 'base' })
        .expect((result) => expect([200, 201]).toContain(result.status));

      expect(response.body).toEqual({
        onboardingId: expect.any(String),
        status: 'awaiting_user',
        currentStep: 'collect_email',
        expiresAt: null,
      });

      const onboardingId = response.body.onboardingId as string;
      const suppressedRow = await waitForAuditRow(
        () => readOnboardingAuditRows(onboardingId),
        (row) => row.action === 'webhook.outbound_notification_suppressed',
      );
      expectExactAuditRow(suppressedRow, {
        action: 'webhook.outbound_notification_suppressed',
        resourceType: 'onboarding',
        resourceId: onboardingId,
        metadata: {
          eventType: 'onboarding.state_changed',
          operation: 'notify',
          reason: 'no_configured_webhook',
        },
      });
      expect(await readOutboxRows(onboardingId)).toHaveLength(0);
    } finally {
      getRootNotifyWebhookSpy.mockRestore();
    }
  });

  it('records outbound notification suppression for the base workflow transition without mocking getRootNotifyWebhook', async () => {
    const startResponse = await request(getApp().getHttpServer())
      .post('/v1/onboardings')
      .send({ workflowId: 'base' })
      .expect((result) => expect([200, 201]).toContain(result.status));

    expect(startResponse.body).toEqual({
      onboardingId: expect.any(String),
      status: 'awaiting_user',
      currentStep: 'collect_email',
      expiresAt: null,
    });

    const onboardingId = startResponse.body.onboardingId as string;
    const submitResponse = await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect((result) => expect([200, 201]).toContain(result.status));

    expect(submitResponse.body).toEqual({
      appliedStep: 'collect_email',
      status: 'awaiting_user',
      currentStep: 'accept_terms',
      rejectionReason: null,
    });

    const suppressedRow = await waitForAuditRow(
      () => readOnboardingAuditRows(onboardingId),
      (row) => row.action === 'webhook.outbound_notification_suppressed',
    );
    expectExactAuditRow(suppressedRow, {
      action: 'webhook.outbound_notification_suppressed',
      resourceType: 'onboarding',
      resourceId: onboardingId,
      metadata: {
        eventType: 'onboarding.state_changed',
        operation: 'notify',
        reason: 'no_configured_webhook',
      },
    });
  });

  it('records outbound endpoint resolution failure and preserves the committed onboarding row', async () => {
    const clientWebhookUrlResolver = getApp().get(ClientWebhookUrlResolver);
    jest.spyOn(clientWebhookUrlResolver, 'resolve').mockImplementation(() => {
      throw new Error('endpoint unavailable');
    });

    const onboardingId = await seedAcceptedSubmitOnboarding();
    const webhookService = getApp().get(WebhookService);
    const workflow = await getApp().get(WorkflowRegistryService).getById('base', 1);

    await expect(
      webhookService.notify(
        {
          id: onboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: 'accept_terms',
          completedAt: null,
        },
        workflow,
      ),
    ).resolves.toBeUndefined();

    const endpointResolutionRow = await waitForAuditRow(
      () => readOnboardingAuditRows(onboardingId),
      (row) => row.action === 'webhook.outbound_endpoint_resolution_failed',
    );
    expectExactAuditRow(endpointResolutionRow, {
      action: 'webhook.outbound_endpoint_resolution_failed',
      resourceType: 'onboarding',
      resourceId: onboardingId,
      metadata: {
        eventType: 'onboarding.state_changed',
        reason: 'endpoint_resolution_failed',
        payload: {
          version: 1,
          event: {
            id: expect.any(String),
            type: 'onboarding.state_changed',
            occurredAt: expect.any(String),
          },
          onboarding: {
            id: onboardingId,
            workflowId: 'base',
            workflowVersion: 1,
            status: 'awaiting_user',
            currentStep: 'accept_terms',
            completedAt: null,
          },
        },
      },
    });
    expect(endpointResolutionRow?.metadata).not.toHaveProperty('endpointUrl');
    expect(endpointResolutionRow?.metadata).not.toHaveProperty('path');
    expect(await readOnboardingRows(onboardingId)).toEqual([
      expect.objectContaining({
        id: onboardingId,
        workflow_id: 'base',
        workflow_version: 1,
        status: 'awaiting_user',
        current_step: 'accept_terms',
        context: expect.objectContaining({
          email: expect.any(String),
        }),
        completed_at: null,
      }),
    ]);
    expect(await readOutboxRows(onboardingId)).toHaveLength(0);
  });

  it('records outbound resend_requested and resend_not_found audit rows for a missing outbox id', async () => {
    const webhookService = getApp().get(WebhookService);
    const missingOutboxId = '01900000-0000-7000-8000-000000000099';

    await expect(webhookService.resend(missingOutboxId)).rejects.toMatchObject({
      response: {
        code: 'CLIENT_WEBHOOK_OUTBOX_NOT_FOUND',
        message: 'CLIENT_WEBHOOK_OUTBOX_NOT_FOUND',
      },
      status: 404,
    });

    const webhookRows = await readWebhookAuditRows(missingOutboxId);
    expectExactAuditRow(
      webhookRows.find((row) => row.action === 'webhook.outbound_resend_requested'),
      {
        action: 'webhook.outbound_resend_requested',
        resourceType: 'client_webhook_outbox',
        resourceId: missingOutboxId,
        metadata: { operation: 'resend', payload: null },
      },
    );
    expectExactAuditRow(
      webhookRows.find((row) => row.action === 'webhook.outbound_resend_not_found'),
      {
        action: 'webhook.outbound_resend_not_found',
        resourceType: 'client_webhook_outbox',
        resourceId: missingOutboxId,
        metadata: { outcome: 'not_found', payload: null },
      },
    );
  });

  it('records outbound resend_noop already_delivered when a delivered outbox row is resent', async () => {
    const webhookService = getApp().get(WebhookService);
    const onboardingId = await seedAcceptedSubmitOnboarding();

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((result) => expect([200, 201]).toContain(result.status));

    const outboxRows = await readOutboxRows(onboardingId);
    expect(outboxRows).toHaveLength(1);
    await deliverOutbox(outboxRows[0].id);

    await expect(webhookService.resend(outboxRows[0].id)).resolves.toBeUndefined();

    const webhookRows = await readWebhookAuditRows(outboxRows[0].id);
    expectExactAuditRow(
      webhookRows.find((row) => row.action === 'webhook.outbound_resend_requested'),
      {
        action: 'webhook.outbound_resend_requested',
        resourceType: 'client_webhook_outbox',
        resourceId: outboxRows[0].id,
        metadata: { operation: 'resend', payload: outboxRows[0].payload },
      },
    );
    expectExactAuditRow(
      webhookRows.find((row) => row.action === 'webhook.outbound_resend_noop'),
      {
        action: 'webhook.outbound_resend_noop',
        resourceType: 'client_webhook_outbox',
        resourceId: outboxRows[0].id,
        metadata: { outcome: 'already_delivered', payload: outboxRows[0].payload },
      },
    );
  });

  it('records outbound resend_noop already_sending when a sending outbox row is resent', async () => {
    const webhookService = getApp().get(WebhookService);
    const onboardingId = await seedAcceptedSubmitOnboarding();

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((result) => expect([200, 201]).toContain(result.status));

    const outboxRows = await readOutboxRows(onboardingId);
    expect(outboxRows).toHaveLength(1);

    await dataSource().query(
      `UPDATE client_webhook_outbox
        SET status = $2, delivered_at = $3, sending_started_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [outboxRows[0].id, 'SENDING', null],
    );

    await expect(webhookService.resend(outboxRows[0].id)).resolves.toBeUndefined();

    const webhookRows = await readWebhookAuditRows(outboxRows[0].id);
    expectExactAuditRow(
      webhookRows.find((row) => row.action === 'webhook.outbound_resend_requested'),
      {
        action: 'webhook.outbound_resend_requested',
        resourceType: 'client_webhook_outbox',
        resourceId: outboxRows[0].id,
        metadata: { operation: 'resend', payload: outboxRows[0].payload },
      },
    );
    expectExactAuditRow(
      webhookRows.find((row) => row.action === 'webhook.outbound_resend_noop'),
      {
        action: 'webhook.outbound_resend_noop',
        resourceType: 'client_webhook_outbox',
        resourceId: outboxRows[0].id,
        metadata: { outcome: 'already_sending', payload: outboxRows[0].payload },
      },
    );
  });

  it('queues a pending resend without claiming it in the API process', async () => {
    const webhookService = getApp().get(WebhookService);
    const onboardingId = await seedAcceptedSubmitOnboarding();

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((result) => expect([200, 201]).toContain(result.status));

    const outboxRows = await readOutboxRows(onboardingId);
    expect(outboxRows).toHaveLength(1);

    await expect(webhookService.resend(outboxRows[0].id)).resolves.toBeUndefined();

    const webhookRows = await readWebhookAuditRows(outboxRows[0].id);
    expectExactAuditRow(
      webhookRows.find((row) => row.action === 'webhook.outbound_resend_requested'),
      {
        action: 'webhook.outbound_resend_requested',
        resourceType: 'client_webhook_outbox',
        resourceId: outboxRows[0].id,
        metadata: { operation: 'resend', payload: outboxRows[0].payload },
      },
    );
    expect(
      webhookRows.find((row) => row.action === 'webhook.outbound_resend_noop'),
    ).toBeUndefined();
  });

  it('persists onboarding.rejected_attempt for unsupported manual review actions', async () => {
    const unsupportedManualTransitionOnboardingId = await startWorkflowOnboarding(
      'manual-review',
      'awaiting_manual_review',
      'awaiting_manual_review',
    );
    const unsupportedRowsBefore = await readAuditRows(unsupportedManualTransitionOnboardingId);

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${unsupportedManualTransitionOnboardingId}/review/return`)
      .expect(400)
      .expect({
        message: ['action must be one of the following values: approve, reject, invalid'],
        error: 'Bad Request',
        statusCode: 400,
      });

    const unsupportedRowsAfter = await expectLatestRejectedAttemptAuditRow(
      unsupportedManualTransitionOnboardingId,
      {
        operation: 'manual_review',
        outcome: 'unsupported_action',
      },
    );
    expect(unsupportedRowsAfter).toHaveLength(unsupportedRowsBefore.length + 1);
  });

  it('allows unauthenticated access on the audit read route', async () => {
    const onboardingId = await seedAcceptedSubmitOnboarding();
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((result) => expect([200, 201]).toContain(result.status));

    await request(getApp().getHttpServer())
      .get('/v1/admin/audit')
      .expect(200)
      .expect((result) => {
        expect(result.body).toEqual({
          items: expect.any(Array),
          meta: {
            pagination: expect.objectContaining({
              page: 1,
              limit: 20,
            }),
          },
        });
      });
  });

  it('returns the allowlisted audit event projection with deterministic ordering and no sensitive fields', async () => {
    const onboardingId = await seedAcceptedSubmitOnboarding();
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((result) => expect([200, 201]).toContain(result.status));

    const secondOnboardingId = await seedAcceptedSubmitOnboarding();
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${secondOnboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((result) => expect([200, 201]).toContain(result.status));

    const response = await request(getApp().getHttpServer()).get('/v1/admin/audit').expect(200);

    expect(response.body).toEqual({
      items: expect.any(Array),
      meta: {
        pagination: expect.objectContaining({
          page: 1,
          limit: 20,
        }),
      },
    });

    const items = response.body.items as Array<Record<string, unknown>>;
    const pagination = response.body.meta.pagination as {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };

    expect(pagination.total).toBeGreaterThanOrEqual(items.length);
    expect(pagination.totalPages).toBe(Math.ceil(pagination.total / pagination.limit));
    const ownedResourceIds = new Set([onboardingId, secondOnboardingId]);
    const testOwnedItems = items.filter(
      (item) =>
        item.resourceType === 'onboarding' && ownedResourceIds.has(item.resourceId as string),
    );

    expect(testOwnedItems).toHaveLength(2);
    expect(testOwnedItems[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        occurredAt: expect.any(String),
        actorType: 'system',
        actorId: 'engine',
        action: 'onboarding.state_transition',
        resourceType: 'onboarding',
        resourceId: secondOnboardingId,
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: 'accept_terms',
          fromStatus: 'awaiting_user',
          toStatus: 'approved',
          fromCurrentStep: 'accept_terms',
          toCurrentStep: null,
          fromScores: {},
          toScores: {},
        },
      }),
    );
    expect(testOwnedItems[0]).not.toHaveProperty('before');
    expect(testOwnedItems[0]).not.toHaveProperty('after');
    expect(testOwnedItems[0]).not.toHaveProperty('hashPrev');
    expect(testOwnedItems[0]).not.toHaveProperty('hashSelf');
    expect(testOwnedItems[0]).not.toHaveProperty('context');
    expect(testOwnedItems[0]).not.toHaveProperty('submittedData');
    expect(testOwnedItems[0]).not.toHaveProperty('secret');
    expect(testOwnedItems[0]).not.toHaveProperty('otp');
    expect(testOwnedItems[0]).not.toHaveProperty('pii');
    expect(testOwnedItems[0]).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: 'accept_terms',
          fromStatus: 'awaiting_user',
          toStatus: 'approved',
          fromCurrentStep: 'accept_terms',
          toCurrentStep: null,
        }),
      }),
    );
    expect(testOwnedItems[1].resourceId).toBe(onboardingId);
  });

  it('filters by exact predicates, inclusive date bounds, and stable tie ordering', async () => {
    await seedAuditRows([
      {
        id: '01912345-6789-7abc-8def-0123456789aa',
        occurredAt: '2026-07-20T12:00:00.000Z',
        actorType: 'system',
        actorId: 'engine',
        action: 'onboarding.state_transition',
        resourceType: 'onboarding',
        resourceId: 'resource-1',
        metadata: { workflowId: 'base', workflowVersion: 1 },
      },
      {
        id: '01912345-6789-7abc-8def-0123456789ab',
        occurredAt: '2026-07-21T12:00:00.000Z',
        actorType: 'system',
        actorId: 'engine',
        action: 'onboarding.state_transition',
        resourceType: 'onboarding',
        resourceId: 'resource-2',
        metadata: { workflowId: 'base', workflowVersion: 1 },
      },
      {
        id: '01912345-6789-7abc-8def-0123456789ac',
        occurredAt: '2026-07-21T12:00:00.000Z',
        actorType: 'system',
        actorId: 'engine',
        action: 'onboarding.state_transition',
        resourceType: 'onboarding',
        resourceId: 'resource-3',
        metadata: { workflowId: 'base', workflowVersion: 1 },
      },
      {
        id: '01912345-6789-7abc-8def-0123456789ad',
        occurredAt: '2026-07-22T12:00:00.000Z',
        actorType: 'system',
        actorId: 'reviewer',
        action: 'manualReview',
        resourceType: 'onboarding',
        resourceId: 'resource-4',
        metadata: { workflowId: 'base', workflowVersion: 1 },
      },
    ]);

    const response = await request(getApp().getHttpServer())
      .get('/v1/admin/audit')
      .query({
        actorType: 'system',
        action: 'onboarding.state_transition',
        resourceType: 'onboarding',
        occurredFrom: '2026-07-20T00:00:00.000Z',
        occurredTo: '2026-07-21T23:59:59.000Z',
      })
      .expect(200);

    expect(response.body.items.map((item: Record<string, unknown>) => item.resourceId)).toEqual([
      'resource-3',
      'resource-2',
      'resource-1',
    ]);
    expect(response.body.items[0]).toEqual(
      expect.objectContaining({
        actorType: 'system',
        action: 'onboarding.state_transition',
        resourceType: 'onboarding',
        metadata: expect.objectContaining({ workflowId: 'base' }),
      }),
    );
    expect(response.body.items[0]).not.toHaveProperty('before');
    expect(response.body.items[0]).not.toHaveProperty('hashPrev');
  });

  it('propagates rejected-attempt audit insertion failures', async () => {
    const auditService = getApp().get(AuditService);
    const submitMissingOnboardingId = '01900000-0000-7000-8000-000000000012';
    const manualReviewOnboardingId = await startWorkflowOnboarding(
      'manual-review',
      'awaiting_manual_review',
      'awaiting_manual_review',
    );

    const manualWorkflow = await pinWorkflowInstance('manual-review', 1);
    const evaluateManualSpy = jest
      .spyOn(manualWorkflow, 'evaluateManual')
      .mockReturnValue(WorkflowEvaluationResult.unknownEvaluation());

    jest
      .spyOn(auditService, 'logRejectedAttempt')
      .mockRejectedValueOnce(new Error('submit rejected-attempt insert failed'))
      .mockRejectedValueOnce(new Error('manual rejected-attempt insert failed'));

    try {
      await request(getApp().getHttpServer())
        .post(`/v1/onboardings/${submitMissingOnboardingId}/submit`)
        .send({ acceptedTerms: true })
        .expect(500);

      await request(getApp().getHttpServer())
        .post(`/v1/onboardings/${manualReviewOnboardingId}/review/approve`)
        .expect(500);

      expect((await readAuditRows(submitMissingOnboardingId)) as AuditLogRow[]).toHaveLength(0);

      const manualRows = (await readAuditRows(manualReviewOnboardingId)) as AuditLogRow[];
      expect(manualRows).toHaveLength(1);
      expect(manualRows[0].action).toBe('onboarding.started');
    } finally {
      evaluateManualSpy.mockRestore();
    }
  });

  it('rejects invalid, blank, overlong, repeated, and reversed audit query values with 400', async () => {
    const invalidCases = [
      { actorType: '   ' },
      { actorType: 'a'.repeat(65) },
      { actorType: ['system', 'engine'] },
      { occurredFrom: 'not-a-date' },
      { occurredFrom: '2026-07-20' },
      { occurredFrom: '2026-07-22T00:00:00.000Z', occurredTo: '2026-07-21T00:00:00.000Z' },
    ];

    for (const query of invalidCases) {
      await request(getApp().getHttpServer()).get('/v1/admin/audit').query(query).expect(400);
    }
  });

  it('rolls back onboarding, outbox, and audit rows when the start audit insert fails', async () => {
    const onboardingId = '01900000-0000-7000-8000-000000000001';
    const auditService = getApp().get(AuditService);

    jest.spyOn(uuidUtil, 'generateUuidV7').mockReturnValueOnce(onboardingId);
    jest.spyOn(auditService, 'log').mockRejectedValueOnce(new Error('start audit insert failed'));

    await request(getApp().getHttpServer())
      .post('/v1/onboardings')
      .send({ workflowId: 'base' })
      .expect(500);

    expect(await readOnboardingRows(onboardingId)).toHaveLength(0);
    expect(await readAuditRows(onboardingId)).toHaveLength(0);
  });

  it('rolls back onboarding, outbox, and audit rows when the submit audit insert fails', async () => {
    const onboardingId = await seedAcceptedSubmitOnboarding();
    const auditService = getApp().get(AuditService);

    jest.spyOn(auditService, 'log').mockRejectedValueOnce(new Error('submit audit insert failed'));

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect(500);

    expect(await readOnboardingRows(onboardingId)).toEqual([
      expect.objectContaining({
        id: onboardingId,
        workflow_id: 'base',
        workflow_version: 1,
        status: 'awaiting_user',
        current_step: 'accept_terms',
        context: expect.objectContaining({
          email: expect.any(String),
        }),
        completed_at: null,
      }),
    ]);
    expect(await readAuditRows(onboardingId)).toHaveLength(0);
  });

  it('rolls back onboarding, outbox, and audit rows when the manual review audit insert fails', async () => {
    const onboardingId = await seedManualReviewOnboarding();
    const auditService = getApp().get(AuditService);

    jest
      .spyOn(auditService, 'log')
      .mockRejectedValueOnce(new Error('manual review audit insert failed'));

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${onboardingId}/review/approve`)
      .expect(500);

    expect(await readOnboardingRows(onboardingId)).toEqual([
      expect.objectContaining({
        id: onboardingId,
        workflow_id: 'manual-review',
        workflow_version: 1,
        status: 'awaiting_manual_review',
        current_step: 'awaiting_manual_review',
        context: {},
        completed_at: null,
      }),
    ]);
    expect(await readAuditRows(onboardingId)).toHaveLength(0);
  });
  it('keeps lifecycle and audit commits when outbox persistence fails after lifecycle commit', async () => {
    const onboardingId = await seedAcceptedSubmitOnboarding();
    const webhookRepository = getApp().get(WebhookRepository);
    const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    jest
      .spyOn(webhookRepository, 'createPending')
      .mockRejectedValue(new Error('outbox insert failed'));

    const response = await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((result) => expect([200, 201]).toContain(result.status));

    const logMessages = loggerSpy.mock.calls.map(([message]) => String(message));
    expect(
      logMessages.some((message) => message.includes('CLIENT_WEBHOOK_OUTBOX_PERSISTENCE_FAILED')),
    ).toBe(true);
    expect(logMessages.some((message) => message.includes('/notify'))).toBe(false);
    expect(logMessages.some((message) => message.includes('payload'))).toBe(false);
    expect(logMessages.some((message) => message.includes('secret'))).toBe(false);
    expect(logMessages.some((message) => message.includes('https://'))).toBe(false);
    loggerSpy.mockRestore();

    expect(response.body).toEqual({
      appliedStep: 'accept_terms',
      status: 'approved',
      currentStep: null,
      rejectionReason: null,
    });

    expect(await readOnboardingRows(onboardingId)).toEqual([
      expect.objectContaining({
        id: onboardingId,
        workflow_id: 'base',
        workflow_version: 1,
        status: 'approved',
        current_step: null,
        context: expect.objectContaining({
          email: expect.any(String),
          acceptedTerms: true,
        }),
        completed_at: expect.any(Date),
      }),
    ]);

    expect(await readOutboxRows(onboardingId)).toHaveLength(0);
    expect(await readAuditRows(onboardingId)).toHaveLength(1);
  });

  it('keeps committed onboarding, audit, and outbox rows when notification fails after commit', async () => {
    const onboardingId = await seedAcceptedSubmitOnboarding();
    webhookResponseMode = 'failure';

    const response = await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((result) => expect([200, 201]).toContain(result.status));

    expect(response.body).toEqual({
      appliedStep: 'accept_terms',
      status: 'approved',
      currentStep: null,
      rejectionReason: null,
    });

    expect(await readOnboardingRows(onboardingId)).toEqual([
      expect.objectContaining({
        id: onboardingId,
        workflow_id: 'base',
        workflow_version: 1,
        status: 'approved',
        current_step: null,
        context: expect.objectContaining({
          email: expect.any(String),
          acceptedTerms: true,
        }),
        completed_at: expect.any(Date),
      }),
    ]);

    expect(await readAuditRows(onboardingId)).toHaveLength(1);

    expect(await readOutboxRows(onboardingId)).toEqual([
      expect.objectContaining({
        onboarding_id: onboardingId,
        event_type: 'onboarding.state_changed',
        status: 'PENDING',
        attempts: 0,
        delivered_at: null,
      }),
    ]);
  });
});
