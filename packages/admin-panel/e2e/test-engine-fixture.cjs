const http = require('node:http');
const process = require('node:process');
const { setTimeout: delay } = require('node:timers/promises');
const { URL } = require('node:url');

const crypto = require('node:crypto');

const HOST = '127.0.0.1';
const PATH = '/v1/onboardings';
const AUTH_PREFIX = '/v1/auth/';
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

/**
 * Cookie-session stand-in for the engine's better-auth endpoints, for the paths and response
 * shapes the better-auth 1.7.25 client uses. Accounts are chosen by email so specs running in
 * parallel never share state; every mutation (enrolling in two-factor) lives on the session.
 */
const SESSION_COOKIE = 'fixture_session';
const PENDING_COOKIE = 'fixture_pending';
const PASSWORD = 'correct-horse-battery';
/** The only authenticator code the fixture accepts. */
const TOTP_CODE = '123456';
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const BACKUP_CODES = ['aaaa-1111', 'bbbb-2222', 'cccc-3333', 'dddd-4444'];
/** A session cookie value a spec can plant to start signed in without an enrolled second factor. */
const SEEDED_UNENROLLED_TOKEN = 'seeded-unenrolled-session';

const ACCOUNTS = {
  'operator@example.com': { id: 'user-operator', twoFactorEnabled: true, hasPermission: true },
  'enrolling@example.com': { id: 'user-enrolling', twoFactorEnabled: false, hasPermission: true },
  'viewer@example.com': { id: 'user-viewer', twoFactorEnabled: true, hasPermission: false },
};

const sessions = new Map([
  [SEEDED_UNENROLLED_TOKEN, createSession('enrolling@example.com', false)],
]);
const pendingChallenges = new Map();
/** Whether admin routes demand a session; off for the passes that run with the gate disabled. */
let enforceAuth = false;

function createSession(email, twoFactorEnabled) {
  return { email, twoFactorEnabled, hasPermission: ACCOUNTS[email].hasPermission };
}

function readCookie(request, name) {
  const cookies = (request.headers.cookie || '').split(';');

  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split('=');

    if (key === name) {
      return value.join('=');
    }
  }

  return null;
}

function cookieHeader(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function findSession(request) {
  const token = readCookie(request, SESSION_COOKIE);

  return token === null ? null : (sessions.get(token) ?? null);
}

function toUser(session) {
  const { id } = ACCOUNTS[session.email];

  return {
    id,
    email: session.email,
    name: session.email.split('@')[0],
    emailVerified: true,
    image: null,
    role: 'user',
    twoFactorEnabled: session.twoFactorEnabled,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function toSessionPayload(token, session) {
  return {
    session: {
      id: `session-${token}`,
      token,
      userId: ACCOUNTS[session.email].id,
      activeOrganizationId: null,
      expiresAt: '2099-01-01T00:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
    user: toUser(session),
  };
}

function startSession(email, twoFactorEnabled) {
  const token = crypto.randomUUID();
  const session = createSession(email, twoFactorEnabled);

  sessions.set(token, session);

  return { token, session, cookies: [cookieHeader(SESSION_COOKIE, token, 3600)] };
}

function readJsonBody(request) {
  return new Promise((resolve) => {
    const chunks = [];

    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function sendAuthError(response, status, code, message) {
  sendJson(response, status, { code, message });
}

/** Answers one `/v1/auth/*` request; returns false for a path the fixture does not emulate. */
async function respondToAuth(request, response, pathname) {
  const route = `${request.method} ${pathname.slice(AUTH_PREFIX.length - 1)}`;
  const session = findSession(request);
  const token = readCookie(request, SESSION_COOKIE);

  switch (route) {
    case 'GET /get-session':
      sendJson(response, 200, session ? toSessionPayload(token, session) : null);
      return true;

    case 'GET /organization/list':
      sendJson(response, 200, []);
      return true;

    case 'POST /sign-in/email': {
      const { email, password } = await readJsonBody(request);
      const account = ACCOUNTS[email];

      if (!account || password !== PASSWORD) {
        sendAuthError(response, 401, 'INVALID_EMAIL_OR_PASSWORD', 'Invalid email or password');
        return true;
      }

      if (account.twoFactorEnabled) {
        const challenge = crypto.randomUUID();

        pendingChallenges.set(challenge, email);
        response.setHeader('set-cookie', cookieHeader(PENDING_COOKIE, challenge, 600));
        sendJson(response, 200, { twoFactorRedirect: true, twoFactorMethods: ['totp'] });
        return true;
      }

      const started = startSession(email, false);

      response.setHeader('set-cookie', started.cookies);
      sendJson(response, 200, {
        redirect: false,
        token: started.token,
        user: toUser(started.session),
      });
      return true;
    }

    case 'POST /two-factor/enable': {
      const { password } = await readJsonBody(request);

      if (!session) {
        sendAuthError(response, 401, 'UNAUTHORIZED', 'Unauthorized');
      } else if (password !== PASSWORD) {
        sendAuthError(response, 400, 'INVALID_PASSWORD', 'Invalid password');
      } else {
        sendJson(response, 200, {
          totpURI: `otpauth://totp/Fixture:${session.email}?secret=${TOTP_SECRET}&issuer=Fixture`,
          backupCodes: BACKUP_CODES,
        });
      }

      return true;
    }

    case 'POST /two-factor/verify-totp':
    case 'POST /two-factor/verify-backup-code': {
      const { code } = await readJsonBody(request);
      const accepted = route.endsWith('verify-totp') ? TOTP_CODE : BACKUP_CODES[0];

      if (code !== accepted) {
        sendAuthError(response, 401, 'INVALID_CODE', 'Invalid code');
        return true;
      }

      // Enrolment verification runs against an existing session; a sign-in challenge runs against
      // the pending cookie and only now creates the session.
      if (session) {
        session.twoFactorEnabled = true;
        sendJson(response, 200, { token, user: toUser(session) });
        return true;
      }

      const challenge = readCookie(request, PENDING_COOKIE);
      const email = challenge === null ? undefined : pendingChallenges.get(challenge);

      if (email === undefined) {
        sendAuthError(response, 401, 'INVALID_TWO_FACTOR_COOKIE', 'Invalid two factor cookie');
        return true;
      }

      pendingChallenges.delete(challenge);
      const started = startSession(email, true);

      response.setHeader('set-cookie', [...started.cookies, cookieHeader(PENDING_COOKIE, '', 0)]);
      sendJson(response, 200, { token: started.token, user: toUser(started.session) });
      return true;
    }

    case 'POST /sign-out':
      if (token !== null) {
        sessions.delete(token);
      }

      response.setHeader('set-cookie', cookieHeader(SESSION_COOKIE, '', 0));
      sendJson(response, 200, { success: true });
      return true;

    default:
      return false;
  }
}

/**
 * The engine's admin guard, in the order it applies: session, second factor, permission. Returns
 * true when it has already answered with a refusal.
 */
function refuseAdminRequest(request, response) {
  if (!enforceAuth) {
    return false;
  }

  const session = findSession(request);

  sendCorsHeaders(response);

  if (!session) {
    sendJson(response, 401, {
      statusCode: 401,
      code: 'ADMIN_SESSION_REQUIRED',
      message: 'An admin session is required.',
    });
    return true;
  }

  if (!session.twoFactorEnabled) {
    sendJson(response, 403, {
      statusCode: 403,
      code: 'TWO_FACTOR_REQUIRED',
      message: 'Two-factor authentication is required.',
    });
    return true;
  }

  if (!session.hasPermission) {
    sendJson(response, 403, {
      statusCode: 403,
      code: 'ADMIN_PERMISSION_MISSING',
      message: 'The admin permission is missing.',
    });
    return true;
  }

  return false;
}

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

/** The panel sends its session cookie cross-origin, so credentials are allowed for its origin. */
function sendCorsHeaders(response) {
  response.setHeader('access-control-allow-origin', PANEL_ORIGIN);
  response.setHeader('access-control-allow-credentials', 'true');
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type');
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
  const isAuthRequest = record.pathname.startsWith(AUTH_PREFIX);

  return (
    record.origin === PANEL_ORIGIN &&
    (isAuthRequest
      ? ['GET', 'POST', 'OPTIONS'].includes(record.method)
      : record.pathname === PATH && ['GET', 'OPTIONS'].includes(record.method))
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
    if (record.pathname.startsWith(AUTH_PREFIX)) {
      sendCorsHeaders(response);

      if (!(await respondToAuth(request, response, record.pathname))) {
        throw new Error(`Fixture does not emulate ${record.method} ${record.pathname}`);
      }

      return;
    }

    if (refuseAdminRequest(request, response)) {
      return;
    }

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

// The runner switches enforcement per pass: the passes with the gate off send no session cookie.
process.on('message', (message) => {
  if (message && typeof message === 'object' && message.type === 'enforce-auth') {
    enforceAuth = message.value === true;
  }
});

server.listen(0, HOST, () => {
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Engine fixture failed to bind to an ephemeral loopback port.');
  }

  // `localhost` rather than the loopback address: the panel is served from `localhost`, and the
  // SameSite=Lax session cookie is only sent back to a host on the same site.
  const url = `http://localhost:${address.port}`;

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
