import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ANALYST_INVESTIGATION_COMPILED } from '../classification/testing/analyst-investigation.fixture';
import { humanizeKey } from '../masking/csv-columns';
import { CSV_SYSTEM_COLUMNS } from '../masking/masking.constants';
import { buildRow } from './compliance/testing/audit-engine';

const ENVIRONMENT = {
  NODE_ENV: 'test',
  MCP_PUBLIC_URL: 'http://localhost:3100',
  MCP_ENGINE_BASE_URL: 'http://engine.test',
  MCP_MASKING_KEY: 'k'.repeat(32),
  MCP_AUTH_ENABLED: 'false',
  MCP_WRITE_TOOLS_ENABLED: 'true',
};

// The listen port is the configured one; supertest's own ephemeral port is not an allowed Host.
const JSON_RPC_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  Host: 'localhost:3100',
};

const WORKFLOW_ID = 'analyst-investigation';
const NEW_WORKFLOW_ID = 'brand-new-flow';
const EXTRA_STEP = 'extra_check';
const WINDOW = { from: '2026-10-01', to: '2026-10-31' };

const REJECTED_ID = '01a19540-0000-71b6-bef5-000000000001';
const REVIEW_ID = '01a19540-0000-71b6-bef5-000000000002';
const PARKED_ID = '01a19540-0000-71b6-bef5-000000000003';

interface Applicant {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  street: string;
  town: string;
  postCode: string;
  occupationTitle: string;
  email: string;
  phoneNumber: string;
}

/** Values of the kind the seeder generates; none of them may reach a response. */
const APPLICANTS: Record<'rejected' | 'review' | 'parked', Applicant> = {
  rejected: {
    firstName: 'Zbigniew',
    lastName: 'Wojciechowski-Quackenbush',
    dateOfBirth: '1987-03-14',
    street: 'ul. Kasztanowa 17/4',
    town: 'Wroclaw',
    postCode: '50-123',
    occupationTitle: 'Freelance subsea welding inspector',
    email: 'zbigniew.wojciechowski@example.com',
    phoneNumber: '+48 601 234 567',
  },
  review: {
    firstName: 'Katarzyna',
    lastName: 'Zielinska-Brzeczyszczykiewicz',
    dateOfBirth: '1992-11-02',
    street: 'Aleja Lipowa 8',
    town: 'Gdynia',
    postCode: '81-310',
    occupationTitle: 'Itinerant lighthouse keeper',
    email: 'katarzyna.zielinska@example.com',
    phoneNumber: '+48 502 876 543',
  },
  parked: {
    firstName: 'Bartosz',
    lastName: 'Kowalczyk-Przybylski',
    dateOfBirth: '1979-07-30',
    street: 'Rynek 3/12',
    town: 'Sandomierz',
    postCode: '27-600',
    occupationTitle: 'Beekeeping equipment broker',
    email: 'bartosz.kowalczyk@example.com',
    phoneNumber: '+48 733 112 998',
  },
};

/** Free-form text a provider or an operator might leave where no field class reaches it. */
const STRAY_TEXT = 'Passport scan shows Jadwiga Nowicka-Oblonczyk, ul. Sloneczna 99';

const PERSONAL_VALUES: string[] = [
  ...Object.values(APPLICANTS).flatMap((applicant) => [
    ...Object.values(applicant),
    applicant.phoneNumber.replace(/\D/g, ''),
    applicant.email.split('@')[0],
  ]),
  STRAY_TEXT,
  'Jadwiga Nowicka-Oblonczyk',
];

const SYSTEM_HEADERS = CSV_SYSTEM_COLUMNS.map(humanizeKey);
const csvCell = (value: string): string => `"${value.replace(/"/g, '""')}"`;

function exportRow(
  onboardingId: string,
  status: string,
  currentStep: string,
  createdAt: string,
  applicant: Applicant,
): string[] {
  return [
    onboardingId,
    WORKFLOW_ID,
    '1',
    status,
    currentStep,
    'not_accepted',
    '',
    createdAt,
    createdAt,
    '',
    '70',
    applicant.firstName,
    applicant.lastName,
    applicant.dateOfBirth,
    'PL',
    applicant.street,
    applicant.town,
    applicant.postCode,
    'PL',
    applicant.occupationTitle,
    'salary',
    'false',
    applicant.email,
    applicant.phoneNumber,
    JSON.stringify({ note: STRAY_TEXT }),
  ];
}

/** The engine's export names the system columns, then the declared fields in step order. */
const EXPORT_COLUMN_ORDER = [
  ...SYSTEM_HEADERS,
  'Risk score',
  humanizeKey('firstName'),
  humanizeKey('lastName'),
  humanizeKey('dateOfBirth'),
  humanizeKey('country'),
  humanizeKey('street'),
  humanizeKey('town'),
  humanizeKey('postCode'),
  humanizeKey('nationality'),
  humanizeKey('occupationTitle'),
  humanizeKey('sourceOfFunds'),
  humanizeKey('pepSelfDeclared'),
  humanizeKey('email'),
  humanizeKey('phoneNumber'),
  humanizeKey('otherData'),
];

const EXPORT_ROWS = [
  exportRow(REJECTED_ID, 'rejected', '', '2026-10-10T10:00:00.000Z', APPLICANTS.rejected),
  exportRow(
    REVIEW_ID,
    'awaiting_manual_review',
    'review_identity',
    '2026-10-12T09:00:00.000Z',
    APPLICANTS.review,
  ),
  exportRow(
    PARKED_ID,
    'awaiting_user',
    'check_identity',
    '2026-10-14T08:00:00.000Z',
    APPLICANTS.parked,
  ),
];

function toCsv(headers: readonly string[], rows: readonly string[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function summaryRow(
  onboardingId: string,
  status: string,
  currentStep: string | null,
  createdAt: string,
  pendingConnector: object | null = null,
) {
  return {
    onboardingId,
    workflowId: WORKFLOW_ID,
    workflowVersion: 1,
    status,
    currentStep,
    expiresAt: null,
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    rejectionReason: null,
    scores: { risk: 70 },
    agreementStatus: 'not_accepted',
    pendingConnector,
  };
}

const ONBOARDINGS = [
  summaryRow(PARKED_ID, 'awaiting_user', 'check_identity', '2026-10-14T08:00:00.000Z', {
    connectorId: 'mock_async_callback_2',
    connectorName: 'identity_check',
    connectorOrder: 1,
    parkedAt: '2026-10-14T08:05:00.000Z',
  }),
  summaryRow(REVIEW_ID, 'awaiting_manual_review', 'review_identity', '2026-10-12T09:00:00.000Z'),
  summaryRow(REJECTED_ID, 'rejected', null, '2026-10-10T10:00:00.000Z'),
];

const TRANSITIONS = [
  {
    id: 'tr-1',
    occurredAt: '2026-10-10T10:00:00.000Z',
    status: 'awaiting_user',
    fromStep: null,
    enteredStep: 'collect_profile',
    appliedStep: null,
    trigger: null,
    current: false,
  },
  {
    id: 'tr-2',
    occurredAt: '2026-10-10T10:05:00.000Z',
    status: 'rejected',
    fromStep: 'collect_profile',
    enteredStep: null,
    appliedStep: 'collect_profile',
    trigger: null,
    current: true,
  },
];

/** What an applicant typed, as the engine writes it into a callback or reconcile audit row. */
const SUBMITTED_DATA = {
  ...APPLICANTS.rejected,
  country: 'PL',
  nationality: 'PL',
  providerVerdict: 'review',
  kycReasonCodes: ['DOCUMENT_BLURRY'],
};

const LIFECYCLE_METADATA = { workflowId: WORKFLOW_ID, workflowVersion: 1 };

type AuditOverrides = Parameters<typeof buildRow>[0] & { before?: object; after?: object };

/** An audit row as the engine lists it, with the snapshots a state change carries. */
function buildEntry({ before, after, ...overrides }: AuditOverrides) {
  return { ...buildRow(overrides), ...(before && { before }), ...(after && { after }) };
}

const AUDIT_ROWS = [
  buildEntry({
    id: 'tr-1',
    action: 'onboarding.started',
    occurredAt: '2026-10-10T10:00:00.000Z',
    actorType: 'anonymous',
    actorId: 'anonymous',
    resourceType: 'onboarding',
    resourceId: REJECTED_ID,
    metadata: {
      ...LIFECYCLE_METADATA,
      toStatus: 'awaiting_user',
      toCurrentStep: 'collect_profile',
      toScores: {},
      applicantName: APPLICANTS.rejected.firstName,
    },
    after: {
      id: REJECTED_ID,
      ...LIFECYCLE_METADATA,
      status: 'awaiting_user',
      currentStep: 'collect_profile',
      scores: {},
      email: APPLICANTS.rejected.email,
    },
  }),
  buildEntry({
    id: 'au-cb',
    action: 'webhook.inbound_callback_applied',
    occurredAt: '2026-10-10T10:03:00.000Z',
    actorType: 'system',
    actorId: 'provider',
    resourceType: 'onboarding',
    resourceId: REJECTED_ID,
    metadata: {
      providerIdentity: 'mock_async_callback_2',
      connectorOrder: 1,
      outcome: 'accepted',
      submittedData: SUBMITTED_DATA,
      connectorExecutionResult: {
        status: 'success',
        metadata: { ownerName: APPLICANTS.rejected.lastName },
      },
    },
  }),
  buildEntry({
    id: 'au-rej',
    action: 'connector.result_rejected',
    occurredAt: '2026-10-10T10:04:00.000Z',
    actorType: 'system',
    actorId: 'engine',
    resourceType: 'onboarding',
    resourceId: REJECTED_ID,
    metadata: {
      stepName: 'check_identity',
      connectorId: 'mock_async_callback_2',
      reason: 'IDENTITY_MISMATCH',
      fieldErrors: { email: ['INVALID'] },
      detail: STRAY_TEXT,
    },
  }),
  buildEntry({
    id: 'tr-2',
    action: 'onboarding.state_transition',
    occurredAt: '2026-10-10T10:05:00.000Z',
    actorType: 'system',
    actorId: 'engine',
    resourceType: 'onboarding',
    resourceId: REJECTED_ID,
    metadata: {
      ...LIFECYCLE_METADATA,
      appliedStep: 'collect_profile',
      fromStatus: 'awaiting_user',
      toStatus: 'rejected',
      fromCurrentStep: 'collect_profile',
      toCurrentStep: null,
      fromScores: {},
      toScores: { risk: 70 },
    },
    before: { id: REJECTED_ID, status: 'awaiting_user', lastName: APPLICANTS.rejected.lastName },
  }),
  buildEntry({
    id: 'au-recon',
    action: 'onboarding.pending_connector_reconciled',
    occurredAt: '2026-10-14T09:00:00.000Z',
    actorType: 'operator',
    actorId: 'oid-ada',
    resourceType: 'onboarding',
    resourceId: PARKED_ID,
    metadata: {
      connectorId: 'mock_async_callback_2',
      connectorOrder: 1,
      providerIdentity: 'mock_async_callback_2',
      submittedData: { ...APPLICANTS.parked, country: 'PL' },
    },
  }),
  buildEntry({
    id: 'au-start-2',
    action: 'onboarding.started',
    occurredAt: '2026-10-12T09:00:00.000Z',
    actorType: 'anonymous',
    actorId: 'anonymous',
    resourceType: 'onboarding',
    resourceId: REVIEW_ID,
    metadata: {
      ...LIFECYCLE_METADATA,
      toStatus: 'awaiting_user',
      toCurrentStep: 'collect_profile',
      toScores: {},
    },
  }),
  buildEntry({
    id: 'au-access',
    action: 'auth.access_granted',
    occurredAt: '2026-10-15T10:00:00.000Z',
    metadata: {
      method: 'GET',
      userPrincipalName: 'ada@bank.example',
      grantedRoles: ['conductor.admin'],
    },
  }),
  buildEntry({
    id: 'au-export',
    action: 'onboardings.exported',
    occurredAt: '2026-10-15T10:01:00.000Z',
    resourceType: 'onboarding',
    resourceId: 'export',
    metadata: {
      status: 'rejected',
      onboardingId: REJECTED_ID,
      filterEmail: APPLICANTS.rejected.email,
    },
  }),
  buildEntry({
    id: 'au-webhook',
    action: 'webhook.delivery_succeeded',
    occurredAt: '2026-10-15T10:02:00.000Z',
    actorType: 'system',
    actorId: 'engine',
    resourceType: 'webhook',
    resourceId: 'outbox-1',
    metadata: {
      eventType: 'onboarding.state_changed',
      status: 'delivered',
      payload: { email: APPLICANTS.rejected.email, firstName: APPLICANTS.rejected.firstName },
      headers: { 'x-applicant': APPLICANTS.rejected.lastName },
    },
  }),
  buildEntry({
    id: 'au-draft',
    action: 'workflow_draft.created',
    occurredAt: '2026-10-16T10:00:00.000Z',
    metadata: { workflowId: WORKFLOW_ID, version: 2 },
  }),
];

const COMPILED_STEPS = ANALYST_INVESTIGATION_COMPILED.steps.map((step) => ({
  status: 'awaiting_user',
  transitions: [],
  ...step,
}));

function compiledDefinition(id: string, version: number) {
  return {
    id,
    version,
    name: 'Analyst investigation',
    initial: 'collect_profile',
    scoring: { risk: { min: 0, max: 100 } },
    steps:
      version === 2
        ? [
            ...COMPILED_STEPS,
            { name: EXTRA_STEP, status: 'awaiting_user', data: {}, transitions: [] },
          ]
        : COMPILED_STEPS,
  };
}

type Query = URLSearchParams;
type Route = (url: URL, body: Record<string, unknown> | undefined) => unknown;

function paged(items: readonly object[], query: Query) {
  const limit = Number(query.get('limit') ?? items.length);
  const page = Number(query.get('page') ?? 1);

  return {
    items: items.slice((page - 1) * limit, page * limit),
    meta: {
      pagination: {
        page,
        limit,
        total: items.length,
        totalPages: Math.max(1, Math.ceil(items.length / limit)),
      },
    },
  };
}

function listOnboardings(query: Query) {
  const parked = query.get('parked');
  const matching = ONBOARDINGS.filter(
    (row) =>
      (query.get('status') === null || row.status === query.get('status')) &&
      (query.get('onboardingId') === null || row.onboardingId === query.get('onboardingId')) &&
      (parked === null || (row.pendingConnector !== null) === (parked === 'true')),
  );

  return paged(matching, query);
}

function listAudit(query: Query) {
  const exact = ['action', 'actorId', 'actorType', 'resourceId', 'resourceType'] as const;
  const from = query.get('occurredFrom');
  const to = query.get('occurredTo');
  const matching = AUDIT_ROWS.filter(
    (row) =>
      exact.every((name) => query.get(name) === null || row[name] === query.get(name)) &&
      (from === null || Date.parse(row.occurredAt) >= Date.parse(from)) &&
      (to === null || Date.parse(row.occurredAt) <= Date.parse(to)),
  ).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

  return paged(matching, query);
}

const ROUTES: Array<[RegExp, string, Route]> = [
  [/^\/v1\/onboardings$/, 'GET', (url) => listOnboardings(url.searchParams)],
  [
    /^\/v1\/onboardings\/export$/,
    'GET',
    (url) => {
      const only = url.searchParams.get('onboardingId');
      const rows = EXPORT_ROWS.filter((row) => only === null || row[0] === only);
      return toCsv(EXPORT_COLUMN_ORDER, rows);
    },
  ],
  [
    /^\/v1\/onboardings\/([^/]+)\/agreements$/,
    'GET',
    () => ({
      items: [
        {
          key: 'terms',
          type: 'terms',
          latestVersion: 2,
          acceptedVersion: null,
          acceptedAt: null,
          status: 'not_accepted',
        },
      ],
    }),
  ],
  [
    /^\/v1\/onboardings\/([^/]+)\/transitions$/,
    'GET',
    (url) => ({ items: url.pathname.includes(REJECTED_ID) ? TRANSITIONS : [] }),
  ],
  [
    /^\/v1\/onboardings\/([^/]+)\/pending-connector\/reconcile$/,
    'POST',
    () => ({
      outcome: 'applied',
      onboarding: summaryRow(PARKED_ID, 'approved', null, '2026-10-14T08:00:00.000Z'),
    }),
  ],
  [
    /^\/v1\/onboardings\/([^/]+)$/,
    'GET',
    (url) => ONBOARDINGS.find((row) => url.pathname.endsWith(row.onboardingId)),
  ],
  [/^\/v1\/admin\/audit$/, 'GET', (url) => listAudit(url.searchParams)],
  [
    /^\/v1\/admin\/workflows$/,
    'GET',
    (url) =>
      paged(
        [
          {
            workflowId: WORKFLOW_ID,
            name: 'Analyst investigation',
            scope: 'fixtures',
            servingVersion: 1,
            inProgressCount: 2,
          },
        ],
        url.searchParams,
      ),
  ],
  [
    /^\/v1\/admin\/workflows\/compile$/,
    'POST',
    (_url, body) => ({ definition: compiledDefinition(String(body?.id), Number(body?.version)) }),
  ],
  [
    /^\/v1\/admin\/workflows$/,
    'POST',
    (_url, body) => ({
      workflowId: body?.id,
      version: body?.version,
      status: 'draft',
      name: body?.name ?? null,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    }),
  ],
  [
    /^\/v1\/admin\/workflows\/([^/]+)\/versions$/,
    'GET',
    () => ({
      items: [
        { version: 1, status: 'published' },
        { version: 2, status: 'published' },
      ],
    }),
  ],
  [
    /^\/v1\/admin\/workflows\/([^/]+)\/versions\/(\d+)\/document$/,
    'GET',
    (url) => {
      const version = Number(url.pathname.split('/')[6]);
      return {
        workflowId: WORKFLOW_ID,
        version,
        status: 'published',
        document: { id: WORKFLOW_ID, version },
      };
    },
  ],
  [
    /^\/v1\/admin\/workflows\/([^/]+)\/versions\/(\d+)$/,
    'GET',
    () => ({ steps: COMPILED_STEPS.map(({ name }) => ({ name, connectors: [] })) }),
  ],
];

function serveEngine(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const method = init?.method ?? 'GET';
  const route = ROUTES.find(([pattern, verb]) => verb === method && pattern.test(url.pathname));

  if (!route) {
    return Promise.resolve(new Response(`No stub for ${method} ${url.pathname}`, { status: 500 }));
  }

  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  const result = route[2](url, body);

  if (result === undefined) {
    return Promise.resolve(new Response('{"message":"not found"}', { status: 404 }));
  }

  return Promise.resolve(
    typeof result === 'string'
      ? new Response(result, { headers: { 'Content-Type': 'text/csv' } })
      : new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } }),
  );
}

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  /** The tool is expected to refuse; the refusal text is still checked. */
  refused?: true;
}

const NEW_DOCUMENT = { id: NEW_WORKFLOW_ID, version: 1, steps: [{ type: 'collect' }] };

const TOOL_CALLS: ToolCall[] = [
  { name: 'list_workflows', args: {} },
  { name: 'get_workflow_version', args: { workflowId: WORKFLOW_ID, version: 1 } },
  { name: 'get_workflow_document', args: { workflowId: WORKFLOW_ID, version: 1 } },
  {
    name: 'diff_workflow_versions',
    args: { workflowId: WORKFLOW_ID, fromVersion: 1, toVersion: 2 },
  },
  { name: 'compile_workflow', args: { document: { id: WORKFLOW_ID, version: 1, steps: [] } } },
  { name: 'find_onboardings', args: { limit: 10 } },
  { name: 'get_onboarding', args: { onboardingId: REJECTED_ID } },
  { name: 'get_onboarding', args: { onboardingId: REVIEW_ID } },
  { name: 'get_onboarding_timeline', args: { onboardingId: REJECTED_ID } },
  { name: 'get_onboarding_timeline', args: { onboardingId: PARKED_ID } },
  { name: 'onboarding_stats', args: { groupBy: 'status' } },
  { name: 'onboarding_stats', args: { groupBy: 'country' } },
  { name: 'onboarding_stats', args: { groupBy: 'email' }, refused: true },
  { name: 'onboarding_funnel', args: { workflowId: WORKFLOW_ID } },
  { name: 'connector_health', args: WINDOW },
  { name: 'review_queue', args: {} },
  { name: 'search_audit', args: { onboardingId: REJECTED_ID } },
  { name: 'search_audit', args: { actionPrefix: 'webhook.' } },
  { name: 'search_audit', args: { actionPrefix: 'onboarding' } },
  { name: 'access_report', args: WINDOW },
  { name: 'reconcile_pending_connector', args: { onboardingId: PARKED_ID } },
  { name: 'reconcile_pending_connector', args: { onboardingId: REJECTED_ID }, refused: true },
  { name: 'create_workflow_draft', args: { document: NEW_DOCUMENT } },
];

describe('tool output masking through the MCP endpoint', () => {
  let app: INestApplication;
  let rpcId = 0;

  beforeAll(async () => {
    Object.assign(process.env, ENVIRONMENT);
    const { AppModule } = await import('../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    // The shared jest config restores spies after every test, so the stubs are set again.
    jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    jest.spyOn(global, 'fetch').mockImplementation(serveEngine);
  });

  afterAll(async () => {
    await app.close();
  });

  async function rpc(method: string, params?: object) {
    rpcId += 1;

    const response = await request(app.getHttpServer())
      .post('/mcp')
      .set(JSON_RPC_HEADERS)
      .send({ jsonrpc: '2.0', id: rpcId, method, params })
      .expect(200);

    return response.body.result;
  }

  async function callTool(name: string, args: Record<string, unknown>) {
    const result = await rpc('tools/call', { name, arguments: args });
    const text: string = result.content[0].text;

    return { text, isError: result.isError === true };
  }

  function expectNoPersonalData(text: string): void {
    const lowered = text.toLowerCase();

    for (const value of PERSONAL_VALUES) {
      expect(lowered).not.toContain(value.toLowerCase());
      expect(lowered).not.toContain(JSON.stringify(value).slice(1, -1).toLowerCase());
    }
  }

  it('calls every tool the endpoint lists', async () => {
    const { tools } = await rpc('tools/list');

    expect(new Set(TOOL_CALLS.map(({ name }) => name))).toEqual(
      new Set(tools.map((tool: { name: string }) => tool.name)),
    );
  });

  it.each(TOOL_CALLS)(
    'returns no personal value from $name $args',
    async ({ name, args, refused }) => {
      const { text, isError } = await callTool(name, args);

      expect(isError).toBe(refused === true);
      expectNoPersonalData(text);
    },
  );

  it('previews a write, then redeems its token, without a personal value in either response', async () => {
    for (const [name, args] of [
      ['reconcile_pending_connector', { onboardingId: PARKED_ID }],
      ['create_workflow_draft', { document: NEW_DOCUMENT }],
    ] as const) {
      const preview = await callTool(name, args);
      const { confirmationToken } = JSON.parse(preview.text);
      const confirmed = await callTool(name, { ...args, confirmationToken });

      expect(typeof confirmationToken).toBe('string');
      expect(confirmed.isError).toBe(false);
      expectNoPersonalData(preview.text + confirmed.text);
    }
  });

  it('gives the same email the same pseudonym in every tool that shows it', async () => {
    const pseudonymOf = (text: string) => text.match(/email:[0-9a-f]{12}/g) ?? [];
    const { text: onboarding } = await callTool('get_onboarding', { onboardingId: REJECTED_ID });
    const { text: timeline } = await callTool('get_onboarding_timeline', {
      onboardingId: REJECTED_ID,
    });
    const { text: audit } = await callTool('search_audit', { onboardingId: REJECTED_ID });
    const collectedEmail = JSON.parse(onboarding).collectedData[humanizeKey('email')];

    expect(collectedEmail).toMatch(/^email:[0-9a-f]{12}$/);
    for (const text of [onboarding, timeline, audit]) {
      expect(new Set(pseudonymOf(text))).toEqual(new Set([collectedEmail]));
    }
  });

  it('gives different applicants different pseudonyms', async () => {
    const { text: rejected } = await callTool('get_onboarding', { onboardingId: REJECTED_ID });
    const { text: review } = await callTool('get_onboarding', { onboardingId: REVIEW_ID });

    expect(JSON.parse(rejected).collectedData[humanizeKey('email')]).not.toBe(
      JSON.parse(review).collectedData[humanizeKey('email')],
    );
  });
});
