const http = require('node:http');
const process = require('node:process');
const { setTimeout: delay } = require('node:timers/promises');
const { URL } = require('node:url');

const HOST = '127.0.0.1';
const PATH = '/v1/onboardings';
const PANEL_ORIGIN = process.env.PANEL_ORIGIN || process.env.BASE_URL || 'http://localhost:5173';
const RESPONSE_DELAY_MS = 250;
const ALLOWED_KEYS = new Set([
  'status',
  'workflowId',
  'workflowVersion',
  'currentStep',
  'onboardingId',
]);
const VALID_STATUSES = new Set(['awaiting_user', 'approved']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createRecord(sequence) {
  const index = sequence + 1;

  return {
    onboardingId: `018f1e2a-${String(index).padStart(4, '0')}-7000-8000-00000000${String(index).padStart(4, '0')}`,
    workflowId:
      index % 8 === 0
        ? 'kyc-enhanced-with-an-excessively-long-workflow-identifier-for-scroll-testing'
        : index % 3 === 0
          ? 'kyc-basic'
          : 'kyc-standard',
    workflowVersion: (index % 4) + 1,
    status: index % 2 === 0 ? 'approved' : 'awaiting_user',
    currentStep:
      index % 8 === 0
        ? 'collect-documents-with-a-long-step-name-to-force-table-overflow'
        : index % 2 === 0
          ? null
          : 'collect-documents',
    expiresAt: index % 2 === 0 ? null : '2026-08-01T00:00:00.000Z',
    createdAt: `2026-07-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    updatedAt: `2026-07-${String((index % 28) + 2).padStart(2, '0')}T00:00:00.000Z`,
    completedAt: index % 2 === 0 ? '2026-07-05T00:00:00.000Z' : null,
    context: { hidden: `fixture-context-row-${index}` },
  };
}

const RESPONSES = [
  ...Array.from({ length: 39 }, (_, sequence) => createRecord(sequence)),
  {
    onboardingId: '018f1e2a-eeee-7000-8000-00000000000e',
    workflowId: 'kyc basic / encoding?',
    workflowVersion: 7,
    status: 'approved',
    currentStep: 'final review / qa?',
    expiresAt: '2026-08-03T00:00:00.000Z',
    createdAt: '2026-07-07T00:00:00.000Z',
    updatedAt: '2026-07-08T00:00:00.000Z',
    completedAt: '2026-07-09T00:00:00.000Z',
    context: { hidden: 'fixture-context-special' },
  },
];

function isUuid(value) {
  return UUID_PATTERN.test(value);
}

function validateQueryParams(searchParams) {
  const seenKeys = new Set();

  for (const [key, value] of searchParams.entries()) {
    if (!ALLOWED_KEYS.has(key) || seenKeys.has(key)) {
      return null;
    }

    seenKeys.add(key);

    if (value.trim().length === 0) {
      return null;
    }

    if (key === 'status' && !VALID_STATUSES.has(value)) {
      return null;
    }

    if (key === 'workflowVersion' && (!/^\d+$/.test(value) || Number.parseInt(value, 10) < 1)) {
      return null;
    }

    if (key === 'onboardingId' && !isUuid(value)) {
      return null;
    }
  }

  return searchParams;
}

function matchesQuery(record, searchParams) {
  const status = searchParams.get('status');
  if (status !== null && record.status !== status) {
    return false;
  }

  const workflowId = searchParams.get('workflowId');
  if (workflowId !== null && record.workflowId !== workflowId) {
    return false;
  }

  const workflowVersion = searchParams.get('workflowVersion');
  if (workflowVersion !== null && String(record.workflowVersion) !== workflowVersion) {
    return false;
  }

  const currentStep = searchParams.get('currentStep');
  if (currentStep !== null && record.currentStep !== currentStep) {
    return false;
  }

  const onboardingId = searchParams.get('onboardingId');
  if (onboardingId !== null && record.onboardingId !== onboardingId) {
    return false;
  }

  return true;
}

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
    headers: request.headers || {},
  };
}

function isValidRequest(record) {
  return (
    record.origin === PANEL_ORIGIN &&
    record.pathname === PATH &&
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

async function respondToGet(request, response) {
  const requestUrl = new URL(request.url || '/', `http://${HOST}`);
  const query = validateQueryParams(requestUrl.searchParams);

  if (query === null) {
    throw new Error(`Fixture received an unsupported query string: ${requestUrl.search}`);
  }

  const filtered = RESPONSES.filter((record) => matchesQuery(record, query));

  if (RESPONSE_DELAY_MS > 0) {
    await delay(RESPONSE_DELAY_MS);
  }

  sendCorsHeaders(response);
  sendJson(response, 200, filtered);
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
    await respondToGet(request, response);
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
