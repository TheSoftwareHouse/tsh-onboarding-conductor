const http = require('node:http');
const process = require('node:process');
const { setTimeout: delay } = require('node:timers/promises');
const { URL } = require('node:url');

const HOST = '127.0.0.1';
const PATH = '/v1/admin/onboardings';
const PANEL_ORIGIN = process.env.PANEL_ORIGIN || process.env.BASE_URL || 'http://localhost:5173';
const RESPONSE_DELAY_MS = 250;

const RESPONSES = [
  {
    status: 200,
    body: [
      {
        onboardingId: '018f1e2a-1111-7000-8000-000000000001',
        workflowId: 'kyc-basic',
        workflowVersion: 1,
        status: 'awaiting_user',
        currentStep: 'collect-documents',
        expiresAt: '2026-08-01T00:00:00.000Z',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z',
        completedAt: null,
        context: { hidden: 'fixture-context-row-one' },
      },
    ],
  },
  {
    status: 200,
    body: [
      {
        onboardingId: '018f1e2a-1111-7000-8000-000000000001',
        workflowId: 'kyc-basic',
        workflowVersion: 1,
        status: 'awaiting_user',
        currentStep: 'collect-documents',
        expiresAt: '2026-08-01T00:00:00.000Z',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z',
        completedAt: null,
        context: { hidden: 'fixture-context-row-one' },
      },
    ],
  },
  {
    status: 200,
    body: [
      {
        onboardingId: '018f1e2a-1111-7000-8000-000000000001',
        workflowId: 'kyc-basic',
        workflowVersion: 1,
        status: 'awaiting_user',
        currentStep: 'collect-documents',
        expiresAt: '2026-08-01T00:00:00.000Z',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z',
        completedAt: null,
        context: { hidden: 'fixture-context-row-one' },
      },
      {
        onboardingId: '018F1E2A-2222-7000-8000-000000000002',
        workflowId: 'kyc-basic',
        workflowVersion: 2,
        status: 'approved',
        currentStep: null,
        expiresAt: null,
        createdAt: '2026-07-03T00:00:00.000Z',
        updatedAt: '2026-07-04T00:00:00.000Z',
        completedAt: '2026-07-05T00:00:00.000Z',
        context: { hidden: 'fixture-context-row-two' },
      },
      {
        onboardingId: '018f1e2a-3333-7000-8000-000000000003',
        workflowId: 'kyc-enhanced-with-an-excessively-long-workflow-identifier-for-scroll-testing',
        workflowVersion: 3,
        status: 'awaiting_user',
        currentStep: 'collect-documents-with-a-long-step-name-to-force-table-overflow',
        expiresAt: '2026-08-02T00:00:00.000Z',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:00:00.000Z',
        completedAt: null,
        context: { hidden: 'fixture-context-row-three' },
      },
    ],
  },
  {
    status: 200,
    body: [
      {
        onboardingId: '018f1e2a-1111-7000-8000-000000000001',
        workflowId: 'kyc-basic',
        workflowVersion: 1,
        status: 'awaiting_user',
        currentStep: 'collect-documents',
        expiresAt: '2026-08-01T00:00:00.000Z',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z',
        completedAt: null,
        context: { hidden: 'fixture-context-row-one' },
      },
      {
        onboardingId: '018F1E2A-2222-7000-8000-000000000002',
        workflowId: 'kyc-basic',
        workflowVersion: 2,
        status: 'approved',
        currentStep: null,
        expiresAt: null,
        createdAt: '2026-07-03T00:00:00.000Z',
        updatedAt: '2026-07-04T00:00:00.000Z',
        completedAt: '2026-07-05T00:00:00.000Z',
        context: { hidden: 'fixture-context-row-two' },
      },
      {
        onboardingId: '018f1e2a-3333-7000-8000-000000000003',
        workflowId: 'kyc-enhanced-with-an-excessively-long-workflow-identifier-for-scroll-testing',
        workflowVersion: 3,
        status: 'awaiting_user',
        currentStep: 'collect-documents-with-a-long-step-name-to-force-table-overflow',
        expiresAt: '2026-08-02T00:00:00.000Z',
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:00:00.000Z',
        completedAt: null,
        context: { hidden: 'fixture-context-row-three' },
      },
    ],
  },
  {
    status: 200,
    body: Array.from({ length: 40 }, (_, index) => ({
      onboardingId: `018f1e2a-${String(index).padStart(4, '0')}-7000-8000-00000000${String(index).padStart(4, '0')}`,
      workflowId: 'kyc-basic',
      workflowVersion: 1,
      status: index % 2 === 0 ? 'awaiting_user' : 'approved',
      currentStep: 'collect-documents',
      expiresAt: '2026-08-01T00:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z',
      completedAt: null,
      context: { hidden: 'fixture-context-row-many' },
    })),
  },
  {
    status: 200,
    body: Array.from({ length: 40 }, (_, index) => ({
      onboardingId: `018f1e2a-${String(index).padStart(4, '0')}-7000-8000-00000000${String(index).padStart(4, '0')}`,
      workflowId: 'kyc-basic',
      workflowVersion: 1,
      status: index % 2 === 0 ? 'awaiting_user' : 'approved',
      currentStep: 'collect-documents',
      expiresAt: '2026-08-01T00:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z',
      completedAt: null,
      context: { hidden: 'fixture-context-row-many' },
    })),
  },
  {
    status: 500,
    body: { error: 'upstream unavailable' },
  },
  {
    status: 500,
    body: { error: 'upstream unavailable' },
  },
  {
    status: 200,
    body: [
      {
        onboardingId: '018f1e2a-4444-7000-8000-000000000004',
        workflowId: 'kyc-reloaded',
        workflowVersion: 4,
        status: 'approved',
        currentStep: 'final-review',
        expiresAt: '2026-08-03T00:00:00.000Z',
        createdAt: '2026-07-07T00:00:00.000Z',
        updatedAt: '2026-07-08T00:00:00.000Z',
        completedAt: '2026-07-09T00:00:00.000Z',
        context: { hidden: 'fixture-context-row-four' },
      },
    ],
  },
];

let getRequestIndex = 0;

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function sendCorsHeaders(response) {
  response.setHeader('access-control-allow-origin', PANEL_ORIGIN);
  response.setHeader('access-control-allow-credentials', 'false');
  response.setHeader('access-control-allow-methods', 'GET, OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type, authorization');
  response.setHeader('access-control-max-age', '86400');
  response.setHeader('vary', 'origin');
}

function recordRequest(request) {
  const url = new URL(request.url || '/', `http://${HOST}`);

  return {
    method: request.method || 'UNKNOWN',
    pathname: url.pathname,
    search: url.search,
    origin: request.headers.origin || null,
  };
}

function isValidRequest(record) {
  return (
    record.origin === PANEL_ORIGIN &&
    record.pathname === PATH &&
    record.search === '' &&
    (record.method === 'GET' || record.method === 'OPTIONS')
  );
}

async function respondWithUnexpected(response, record) {
  sendCorsHeaders(response);
  sendJson(response, 400, {
    error: 'Unexpected request',
    request: record,
  });
}

async function respondToGet(response) {
  const nextResponse = RESPONSES[getRequestIndex];

  if (!nextResponse) {
    throw new Error(`Fixture received more GET requests than expected: ${getRequestIndex + 1}.`);
  }

  getRequestIndex += 1;

  if (RESPONSE_DELAY_MS > 0) {
    await delay(RESPONSE_DELAY_MS);
  }

  sendCorsHeaders(response);
  sendJson(response, nextResponse.status, nextResponse.body);
}

const server = http.createServer(async (request, response) => {
  const record = recordRequest(request);

  if (typeof process.send === 'function') {
    process.send({ type: 'request', request: record });
  }

  if (!isValidRequest(record)) {
    if (typeof process.send === 'function') {
      process.send({ type: 'unexpected-request', request: record });
    }

    await respondWithUnexpected(response, record);
    return;
  }

  if (request.method === 'OPTIONS') {
    sendCorsHeaders(response);
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    await respondToGet(response);
  } catch (error) {
    if (typeof process.send === 'function') {
      process.send({
        type: 'unexpected-request',
        request: record,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    sendCorsHeaders(response);
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(0, HOST, () => {
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Engine fixture failed to bind to an ephemeral loopback port.');
  }

  const url = `http://${HOST}:${address.port}`;

  if (typeof process.send === 'function') {
    process.send({ type: 'ready', url });
  } else {
    process.stdout.write(`${url}\n`);
  }
});

function closeServer() {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  await closeServer();
}

process.on('SIGINT', () => {
  void shutdown().then(() => process.exit(0));
});

process.on('SIGTERM', () => {
  void shutdown().then(() => process.exit(0));
});
