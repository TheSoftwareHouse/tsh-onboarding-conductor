#!/usr/bin/env node
'use strict';

/**
 * Dev-only host service for Lean's LinkSDK (KSA sandbox). The engine never hands a widget token to a
 * client (ADR 0039, 0040), so whoever hosts the widget holds the Lean secret and mints it. This is
 * that host, kept as small as the job: no dependencies, loopback only, not part of Compose or CI.
 *
 *   POST /api/sessions {onboardingId}      create-or-find the Lean customer for the onboarding, mint a
 *                                          customer-scoped token, submit the customer id to the engine
 *                                          (which parks bank_connect), answer {customerId, accessToken,
 *                                          appToken}
 *   GET  /api/onboardings/:id/state        the engine's /state, proxied so the page needs no CORS
 *   GET  /                                 index.html
 *
 * Configuration comes from the environment; scripts/run-ksa-lean-manual-test.sh sources
 * .env.lean.local before starting it:
 *   LEAN_CLIENT_ID, LEAN_CLIENT_SECRET, LEAN_AUTH_BASE_URL, LEAN_API_BASE_URL   required
 *   ENGINE_URL (default http://localhost:3000), LEAN_HARNESS_PORT (default 4100)
 *   LEAN_HARNESS_PUBLIC_HOST (optional): the one public host a tunnel forwards to this server,
 *     e.g. <name>.ngrok-free.dev, so the bank can redirect the customer back over HTTPS
 *
 * The client secret and every token stay in this process: nothing here logs a header, a body or a
 * token, and the browser only ever receives the customer token (one customer, short-lived) and the
 * app token (the client id, public by design).
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = Number(process.env.LEAN_HARNESS_PORT || 4100);
const ENGINE_URL = (process.env.ENGINE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 20000;
const MAX_BODY_BYTES = 4096;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATE_PATH_PATTERN = /^\/api\/onboardings\/([^/]+)\/state$/;
const INDEX_FILE = path.join(__dirname, 'index.html');

const SCOPE_API = 'api';
const SCOPE_CUSTOMER_PREFIX = 'customer.';
const ENGINE_AWAITING_CONNECTOR_CODE = 'ONBOARDING_AWAITING_CONNECTOR';

const REQUIRED_ENV = [
  'LEAN_CLIENT_ID',
  'LEAN_CLIENT_SECRET',
  'LEAN_AUTH_BASE_URL',
  'LEAN_API_BASE_URL',
];

const missing = REQUIRED_ENV.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(`lean-link-harness: missing environment: ${missing.join(', ')}`);
  process.exit(1);
}

const CLIENT_ID = process.env.LEAN_CLIENT_ID;
const CLIENT_SECRET = process.env.LEAN_CLIENT_SECRET;
const AUTH_BASE_URL = process.env.LEAN_AUTH_BASE_URL.replace(/\/+$/, '');
const API_BASE_URL = process.env.LEAN_API_BASE_URL.replace(/\/+$/, '');

class HarnessError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Answers `{status, body}`; `body` is parsed JSON, or null when the response was not JSON. */
async function request(url, init) {
  let response;

  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw new HarnessError(502, `${new URL(url).host} is unreachable (${error.name})`);
  }

  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  return { status: response.status, body };
}

function describeFailure(what, { status, body }) {
  const code = body && (body.code || body.error || body.message);
  const detail = typeof code === 'string' ? ` (${code})` : '';

  return new HarnessError(502, `${what} answered HTTP ${status}${detail}`);
}

async function mintToken(scope) {
  const result = await request(`${AUTH_BASE_URL}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'client_credentials',
      scope,
    }).toString(),
  });

  if (result.status !== 200 || !result.body || typeof result.body.access_token !== 'string') {
    throw describeFailure(`Lean token endpoint (scope ${scope.split('.')[0]})`, result);
  }

  return result.body.access_token;
}

function lean(method, apiPath, apiToken, payload) {
  const headers = { Authorization: `Bearer ${apiToken}` };

  if (payload) {
    headers['Content-Type'] = 'application/json';
  }

  return request(`${API_BASE_URL}${apiPath}`, {
    method,
    headers,
    body: payload ? JSON.stringify(payload) : undefined,
  });
}

/** The customer for this app user id, or null when Lean has none. */
async function findCustomer(apiToken, appUserId) {
  const result = await lean(
    'GET',
    `/customers/v1/app-user-id/${encodeURIComponent(appUserId)}`,
    apiToken,
  );

  if (result.status === 404) {
    return null;
  }

  if (result.status !== 200 || !result.body || typeof result.body.customer_id !== 'string') {
    throw describeFailure('Lean get-customer-by-app-user-id', result);
  }

  return result.body.customer_id;
}

/**
 * Lean's duplicate-create response is not documented, so look up first, then create, and look up
 * once more when the create is refused: a concurrent session for the same onboarding wins the race.
 */
async function ensureCustomer(apiToken, appUserId) {
  const existing = await findCustomer(apiToken, appUserId);

  if (existing) {
    return existing;
  }

  const created = await lean('POST', '/customers/v1', apiToken, { app_user_id: appUserId });

  if (created.body && typeof created.body.customer_id === 'string' && created.status < 300) {
    return created.body.customer_id;
  }

  const raced = await findCustomer(apiToken, appUserId);

  if (raced) {
    return raced;
  }

  throw describeFailure('Lean create-customer', created);
}

/** Parks bank_connect on the customer id. An already-parked step is the expected retry case. */
async function submitCustomerToEngine(onboardingId, customerId) {
  const result = await request(`${ENGINE_URL}/v1/onboardings/${onboardingId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leanCustomerId: customerId }),
  });

  if (result.status >= 200 && result.status < 300) {
    return;
  }

  if (result.status === 409 && result.body && result.body.code === ENGINE_AWAITING_CONNECTOR_CODE) {
    return;
  }

  const code = result.body && result.body.code ? ` (${result.body.code})` : '';

  throw new HarnessError(
    502,
    `the engine refused the bank_connect submit: HTTP ${result.status}${code}. ` +
      'The onboarding must be on bank_connect, i.e. the IBAN check already passed.',
  );
}

async function createSession(onboardingId) {
  const apiToken = await mintToken(SCOPE_API);
  const customerId = await ensureCustomer(apiToken, onboardingId);
  const accessToken = await mintToken(`${SCOPE_CUSTOMER_PREFIX}${customerId}`);

  await submitCustomerToEngine(onboardingId, customerId);

  return { customerId, accessToken, appToken: CLIENT_ID };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;

      if (size > MAX_BODY_BYTES) {
        reject(new HarnessError(413, 'request body too large'));
        req.destroy();

        return;
      }

      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new HarnessError(400, 'request body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function proxyState(res, onboardingId) {
  const result = await request(`${ENGINE_URL}/v1/onboardings/${onboardingId}/state`, {
    method: 'GET',
  });

  sendJson(res, result.status, result.body ?? { message: 'the engine did not answer with JSON' });
}

// Loopback binding does not stop DNS rebinding: a page rebound to 127.0.0.1 still sends its own
// hostname in Host. Only the loopback names this server listens on are served.
const PUBLIC_HOST = process.env.LEAN_HARNESS_PUBLIC_HOST || '';
const ALLOWED_HOSTS = new Set(
  [`127.0.0.1:${PORT}`, `localhost:${PORT}`, PUBLIC_HOST].filter((host) => host !== ''),
);

function assertLocalRequest(req) {
  if (!ALLOWED_HOSTS.has(req.headers.host)) {
    throw new HarnessError(403, 'forbidden host');
  }

  // A cross-origin page cannot send application/json without a CORS preflight, which this server
  // never answers.
  if (
    req.method === 'POST' &&
    !/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')
  ) {
    throw new HarnessError(415, 'content-type must be application/json');
  }
}

async function handle(req, res) {
  assertLocalRequest(req);

  const { pathname } = new URL(req.url, `http://${HOST}`);

  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(INDEX_FILE));

    return;
  }

  if (req.method === 'POST' && pathname === '/api/sessions') {
    const { onboardingId } = await readJsonBody(req);

    if (typeof onboardingId !== 'string' || !UUID_PATTERN.test(onboardingId)) {
      throw new HarnessError(400, 'onboardingId must be a UUID');
    }

    sendJson(res, 200, await createSession(onboardingId));

    return;
  }

  const stateMatch = req.method === 'GET' ? STATE_PATH_PATTERN.exec(pathname) : null;

  if (stateMatch) {
    if (!UUID_PATTERN.test(stateMatch[1])) {
      throw new HarnessError(400, 'onboarding id must be a UUID');
    }

    await proxyState(res, stateMatch[1]);

    return;
  }

  throw new HarnessError(404, 'not found');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    const status = error instanceof HarnessError ? error.status : 500;
    const message = error instanceof HarnessError ? error.message : 'unexpected harness error';

    // Messages are built from hosts, statuses and codes only, never from a header, body or token.
    console.error(
      `lean-link-harness: ${req.method} ${req.url.split('?')[0]} -> ${status}: ${message}`,
    );

    if (!res.headersSent) {
      sendJson(res, status, { message });
    } else {
      res.end();
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`lean-link-harness: listening on http://${HOST}:${PORT} (engine ${ENGINE_URL})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
