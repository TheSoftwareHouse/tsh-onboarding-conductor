const http = require('node:http');
const process = require('node:process');
const { setTimeout: delay } = require('node:timers/promises');
const { URL } = require('node:url');

const HOST = '127.0.0.1';
const PATH = '/v1/onboardings';
const PANEL_ORIGIN = process.env.PANEL_ORIGIN || process.env.BASE_URL || 'http://localhost:5174';
const RESPONSE_DELAY_MS = 250;
const ALLOWED_KEYS = new Set([
  'page',
  'limit',
  'status',
  'workflowId',
  'workflowVersion',
  'currentStep',
  'onboardingId',
]);
/**
 * Mirrors the engine's shared pagination contract by hand, for the same reason as the status list
 * below: this fixture is CommonJS and cannot import the TypeScript source.
 */
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
/**
 * Every status the panel offers in its filter dropdown. Kept in step by hand with
 * `ADMIN_ONBOARDING_STATUSES` in `src/api/onboardings/admin-onboardings.ts` — this
 * fixture is CommonJS and cannot import the TypeScript source. A status missing here comes back
 * as a 400, so selecting it in the panel would fail the run rather than exercise it.
 */
const VALID_STATUSES = new Set([
  'awaiting_user',
  'awaiting_manual_review',
  'approved',
  'rejected',
  'invalid',
]);
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

    if ((key === 'page' || key === 'limit') && !/^\d+$/.test(value)) {
      return null;
    }

    if (key === 'page' && Number.parseInt(value, 10) < 1) {
      return null;
    }

    if (
      key === 'limit' &&
      (Number.parseInt(value, 10) < 1 || Number.parseInt(value, 10) > MAX_LIMIT)
    ) {
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

/** Cuts the matching rows down to the requested page, as the engine's `paginateQueryBuilder` does. */
function paginate(records, searchParams) {
  const page = Number.parseInt(searchParams.get('page') ?? String(DEFAULT_PAGE), 10);
  const limit = Number.parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10);
  const total = records.length;
  const offset = (page - 1) * limit;

  return {
    items: records.slice(offset, offset + limit),
    meta: {
      pagination: {
        page,
        limit,
        total,
        totalPages: total > 0 ? Math.ceil(total / limit) : 0,
      },
    },
  };
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
  response.setHeader('access-control-allow-methods', 'GET, PUT, OPTIONS');
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
  sendJson(response, 200, paginate(filtered, query));
}

/** In-memory draft families for the workflow editor spec, keyed by workflow id; documents are never validated. */
const DRAFT_FAMILIES = new Map();
const DRAFT_ROUTE = /^\/v1\/admin\/workflows\/([^/]+)\/versions(?:\/(\d+)(\/document)?)?$/;
// Each test names its own draft, so one test's save is never another test's starting document.
const DRAFT_ID_PREFIX = 'editor-draft-';

/** The draft family for `workflowId`, created empty on first use; undefined for any other id. */
function findDraftFamily(workflowId) {
  if (!workflowId.startsWith(DRAFT_ID_PREFIX)) {
    return undefined;
  }

  if (!DRAFT_FAMILIES.has(workflowId)) {
    DRAFT_FAMILIES.set(workflowId, {
      version: 1,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      document: { id: workflowId, version: 1, name: 'Editor draft', steps: [] },
    });
  }

  return DRAFT_FAMILIES.get(workflowId);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function toDraftSummary(workflowId, family) {
  return {
    workflowId,
    version: family.version,
    status: 'draft',
    name: family.document.name ?? null,
    createdAt: family.createdAt,
    updatedAt: family.updatedAt,
  };
}

/** Answers a draft route, or returns false when the request is not one. */
async function respondToDraftRoute(request, response, pathname) {
  const match = DRAFT_ROUTE.exec(pathname);
  if (match === null) {
    return false;
  }

  const workflowId = decodeURIComponent(match[1]);
  const version = match[2] === undefined ? null : Number.parseInt(match[2], 10);
  const family = findDraftFamily(workflowId);
  sendCorsHeaders(response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return true;
  }

  if (family === undefined || (version !== null && version !== family.version)) {
    sendJson(response, 404, { code: 'WORKFLOW_NOT_FOUND' });
    return true;
  }

  if (version === null && request.method === 'GET') {
    sendJson(response, 200, {
      items: [
        {
          version: family.version,
          status: 'draft',
          createdAt: family.createdAt,
          updatedAt: family.updatedAt,
        },
      ],
    });
    return true;
  }

  if (version !== null && match[3] !== undefined && request.method === 'GET') {
    sendJson(response, 200, { ...toDraftSummary(workflowId, family), document: family.document });
    return true;
  }

  if (version !== null && match[3] === undefined && request.method === 'PUT') {
    family.document = JSON.parse(await readBody(request));
    family.updatedAt = new Date().toISOString();
    sendJson(response, 200, toDraftSummary(workflowId, family));
    return true;
  }

  return false;
}

const server = http.createServer(async (request, response) => {
  const { pathname } = new URL(request.url || '/', `http://${HOST}`);

  // Draft routes are not onboarding reads: they bypass the runner's onboarding request audit.
  if (pathname.startsWith('/v1/admin/workflows') && request.headers.origin === PANEL_ORIGIN) {
    if (await respondToDraftRoute(request, response, pathname)) {
      return;
    }
  }

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
