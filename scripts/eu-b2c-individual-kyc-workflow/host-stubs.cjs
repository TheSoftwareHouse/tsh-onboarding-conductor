#!/usr/bin/env node
//
// The host-side stubs the EU B2C individual KYC walkthrough needs, so a run can finish on a
// laptop with no real account system behind it. scripts/run-eu-b2c-kyc-manual-test.sh starts it
// itself and stops it again on the way out, so it normally needs no attention. Run it by hand
// only to keep it up across several runs, or to watch its log live:
//
//   node scripts/eu-b2c-individual-kyc-workflow/host-stubs.cjs
//
// A stub already listening on the port is left alone by that script and used as it stands.
//
// It stands in for the account system that the eu-b2c-individual-kyc-eea-local workflow's
// provision_account step calls, and it keeps every call it was given so the walkthrough can show
// what the engine actually sent:
//
//   POST /v1/accounts   the provisioning call, answered 201 with an accountId
//   GET  /__received    everything taken so far, as {"accounts": [...]}
//   POST /__reset       forget it again (DELETE /__received does the same)
//   GET  /__health      a liveness answer, for a wrapper that waits for the port
//
// The engine runs inside Docker Compose and reaches this as http://host.docker.internal:4600,
// which is why it binds 0.0.0.0 and not loopback: a listener on 127.0.0.1 is not reachable from
// a container. On macOS the first run can raise the firewall's "accept incoming connections"
// prompt, and the engine's call fails until that is allowed.
//
// Nothing is written to disk, so restarting it empties /__received. That costs the walkthrough
// nothing: the account id it hands back in section 28 is derived from what this process holds
// now, not from an earlier run.

const http = require('node:http');

const PORT = Number.parseInt(process.env.STUB_PORT ?? process.env.PORT ?? '4600', 10);
const HOST = process.env.STUB_HOST ?? '0.0.0.0';

// Bounded so a malformed call cannot grow the process without limit. The real body is a few
// hundred bytes.
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Every provisioning call taken, oldest first. The walkthrough script reads the last entry and
 * derives the account id it submits in the await_account step from this array's length, so an id
 * is assigned as `acct-<length after the push>` to agree with it.
 */
const accounts = [];

/** Idempotency-Key -> the account it already created, so a retried call creates nothing new. */
const byIdempotencyKey = new Map();

function log(message) {
  process.stdout.write(`[host-stubs] ${new Date().toISOString()} ${message}\n`);
}

/**
 * Answer one request. `close` ends the connection afterwards, which is what a rejection taken
 * mid-upload needs: the rest of the body is never read, so the connection cannot be reused.
 *
 * A client that walked away leaves a response nothing can be written to; that is normal here and
 * only worth stepping over.
 */
function send(res, status, payload, { close = false } = {}) {
  if (res.writableEnded || res.destroyed) {
    return;
  }

  const headers = close ? { connection: 'close' } : {};
  const body = payload === undefined ? undefined : JSON.stringify(payload);

  if (body !== undefined) {
    Object.assign(headers, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    });
  }

  res.writeHead(status, headers);

  const done = close ? () => res.socket?.destroy() : undefined;
  if (body === undefined) {
    res.end(done);
  } else {
    res.end(body, done);
  }
}

function header(req, name) {
  const value = req.headers[name];
  const first = Array.isArray(value) ? value[0] : value;

  return typeof first === 'string' && first.trim().length > 0 ? first.trim() : undefined;
}

function declaredBodySize(req) {
  const declared = Number.parseInt(header(req, 'content-length') ?? '', 10);

  return Number.isFinite(declared) ? declared : undefined;
}

/**
 * Collect the body as text, refusing anything over the cap. The oversized stream is paused rather
 * than destroyed, so the 413 reaches the client instead of a reset connection.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    };

    req.on('data', (chunk) => {
      if (settled) {
        return;
      }

      size += chunk.length;

      if (size > MAX_BODY_BYTES) {
        req.pause();
        fail(Object.assign(new Error('BODY_TOO_LARGE'), { status: 413 }));

        return;
      }

      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('aborted', () => fail(Object.assign(new Error('CLIENT_ABORTED'), { status: 400 })));
    req.on('error', (error) => fail(error));
  });
}

/**
 * POST /v1/accounts — the provisioning call.
 *
 * The engine's http_request connector treats any 2xx as accepted and ignores the body, so what is
 * answered here matters only to a human reading the terminal. A 4xx, on the other hand, is read
 * back: the connector maps `errors` (the workflow's `response.errorsPath`) into per-field
 * validation errors and lets the step be retried, which is why every rejection below answers with
 * that shape rather than a bare status.
 */
async function createAccount(req, res) {
  const declared = declaredBodySize(req);
  if (declared !== undefined && declared > MAX_BODY_BYTES) {
    log(`rejected a provisioning call: it declared ${declared} bytes`);

    return send(res, 413, { errors: { body: ['BODY_TOO_LARGE'] } }, { close: true });
  }

  let raw;
  try {
    raw = await readBody(req);
  } catch (error) {
    const status = error?.status ?? 400;
    log(`rejected a provisioning call: ${error?.message ?? 'the body could not be read'}`);

    return send(
      res,
      status,
      { errors: { body: [error?.message ?? 'BODY_UNREADABLE'] } },
      { close: true },
    );
  }

  let body;
  try {
    body = raw.trim().length === 0 ? {} : JSON.parse(raw);
  } catch {
    log('rejected a provisioning call: the body is not JSON');

    return send(res, 400, { errors: { body: ['INVALID_JSON'] } });
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    log('rejected a provisioning call: the body is not a JSON object');

    return send(res, 400, { errors: { body: ['JSON_OBJECT_REQUIRED'] } });
  }

  // The workflow always sends this ({{execution.onboardingId}}), so its absence means the request
  // was not built the way the declaration says — worth failing loudly rather than recording.
  const onboardingReference =
    typeof body.onboardingReference === 'string' ? body.onboardingReference.trim() : '';
  if (onboardingReference.length === 0) {
    log('rejected a provisioning call: no onboardingReference');

    return send(res, 422, { errors: { onboardingReference: ['ONBOARDING_REFERENCE_REQUIRED'] } });
  }

  // The step sends the onboardingId as Idempotency-Key, so a connector retry must not show up as
  // a second account: the first answer is replayed and nothing is appended. With the header
  // absent — a hand-made curl — the reference stands in for it, which keeps that idempotent too.
  const idempotencyKey = header(req, 'idempotency-key') ?? onboardingReference;
  const existing = byIdempotencyKey.get(idempotencyKey);
  if (existing !== undefined) {
    log(`replayed ${existing.accountId} for Idempotency-Key ${idempotencyKey}`);

    return send(res, 200, {
      accountId: existing.accountId,
      onboardingReference: existing.onboardingReference,
      status: 'exists',
    });
  }

  const account = {
    accountId: `acct-${accounts.length + 1}`,
    onboardingReference,
    idempotencyKey,
    receivedAt: new Date().toISOString(),
    request: body,
  };
  accounts.push(account);
  byIdempotencyKey.set(idempotencyKey, account);

  log(`created ${account.accountId} for onboarding ${onboardingReference}`);

  return send(res, 201, { accountId: account.accountId, onboardingReference, status: 'created' });
}

function handle(req, res) {
  // A client that walks away mid-request makes the response stream emit 'error'. Unhandled, that
  // would take the whole stub down mid-walkthrough, and there is nothing to do about it besides
  // note it.
  res.on('error', (error) => log(`a response could not be written: ${error.message}`));

  const { pathname } = new URL(req.url ?? '/', `http://${header(req, 'host') ?? 'localhost'}`);
  const route = `${req.method} ${pathname}`;

  if (route === 'POST /v1/accounts') {
    createAccount(req, res).catch((error) => {
      log(`a provisioning call failed inside the stub: ${error?.message ?? 'unknown error'}`);
      send(res, 500, { errors: { _stub: ['STUB_FAILED'] } });
    });

    return;
  }

  if (route === 'GET /__received') {
    return send(res, 200, { accounts });
  }

  if (route === 'POST /__reset' || route === 'DELETE /__received') {
    accounts.length = 0;
    byIdempotencyKey.clear();
    log('forgot every account taken so far');

    return send(res, 204);
  }

  if (route === 'GET /__health') {
    return send(res, 200, { status: 'ok' });
  }

  log(`no stub for ${route}`);

  return send(res, 404, { errors: { _stub: [`NO_STUB_FOR ${route}`] } });
}

const server = http.createServer(handle);

/**
 * curl sends `Expect: 100-continue` for a large body and waits before uploading it. Node would
 * answer that on its own, so an oversized call would be uploaded in full only to be refused;
 * taking the event over means the refusal arrives before the bytes do.
 */
server.on('checkContinue', (req, res) => {
  const declared = declaredBodySize(req);

  if (declared !== undefined && declared > MAX_BODY_BYTES) {
    log(`refused ${req.method} ${req.url} before its body: it declared ${declared} bytes`);
    send(res, 413, { errors: { body: ['BODY_TOO_LARGE'] } }, { close: true });

    return;
  }

  res.writeContinue();
  handle(req, res);
});

// A malformed request line or header set is the client's problem, not a reason to stop serving.
server.on('clientError', (error, socket) => {
  log(`a client sent something unparseable: ${error.message}`);

  if (!socket.destroyed) {
    socket.destroy();
  }
});

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    log(`port ${PORT} is taken — an earlier stub is probably still running (lsof -i :${PORT})`);
    process.exit(1);
  }

  throw error;
});

server.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT}`);
  log(`the engine in Compose reaches it as http://host.docker.internal:${PORT}/v1/accounts`);
  log('routes: POST /v1/accounts, GET /__received, POST /__reset, GET /__health');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log(`${signal} — shutting down`);
    // A held-open keep-alive connection would otherwise keep the process up past close().
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
  });
}
