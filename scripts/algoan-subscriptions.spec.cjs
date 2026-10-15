'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, run, pathOf } = require('./algoan-subscriptions.cjs');
const { rebaseBankData } = require('./rebase-bank-data-dates.cjs');

const ENV = {
  ALGOAN_CLIENT_ID: 'cid',
  ALGOAN_CLIENT_SECRET: 'csecret',
  ALGOAN_CALLBACK_SIGNING_SECRET: 'sign-me',
};
const TARGET = 'https://new.trycloudflare.com/v1/webhooks/algoan_credit/callback';

function reply(status, body) {
  return {
    ok: status < 400,
    status,
    statusText: '',
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

function stub(existing = []) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body };
    calls.push(call);
    if (url.endsWith('/v1/oauth/token')) return reply(200, { access_token: 'tok' });
    if (init.method === 'GET') return reply(200, existing);
    if (init.method === 'DELETE') return reply(204);
    const body = JSON.parse(init.body);
    return reply(201, { id: `id-${body.eventName}`, ...body, status: 'ACTIVE' });
  };
  return { calls, fetchImpl };
}

test('parseArgs: create defaults the events and requires a secret source', () => {
  const options = parseArgs(['create', '--target', TARGET, '--secret-from-connector']);
  assert.deepEqual(options.events, ['analysis_completed', 'analysis_failed']);
  assert.equal(options.secretFromConnector, true);
  assert.throws(() => parseArgs(['create', '--target', TARGET]), /--secret/);
  assert.throws(() => parseArgs(['create', '--secret', 'x']), /--target/);
  assert.throws(() => parseArgs(['delete']), /--path/);
  assert.throws(() => parseArgs(['nope']), /unknown command/);
  assert.throws(() => parseArgs(['list', '--wat']), /unknown flag/);
});

test('pathOf extracts the path of a target', () => {
  assert.equal(pathOf(TARGET), '/v1/webhooks/algoan_credit/callback');
});

test('create deletes stale rows for the same path, then posts one signed subscription per event', async () => {
  const { calls, fetchImpl } = stub([
    {
      id: 'old',
      eventName: 'analysis_completed',
      target: 'https://old.example.com/v1/webhooks/algoan_credit/callback',
    },
    { id: 'other', eventName: 'analysis_completed', target: 'https://x.example.com/elsewhere' },
  ]);
  const lines = [];
  await run(['create', '--target', TARGET, '--secret-from-connector'], ENV, fetchImpl, (l) =>
    lines.push(l),
  );

  const token = calls[0];
  assert.equal(token.url, 'https://api.algoan.com/v1/oauth/token');
  assert.equal(token.body, 'grant_type=client_credentials&client_id=cid&client_secret=csecret');
  assert.deepEqual(
    calls.slice(1).map((c) => `${c.method} ${c.url.replace('https://api.algoan.com', '')}`),
    [
      'GET /v1/subscriptions',
      'DELETE /v1/subscriptions/old',
      'POST /v1/subscriptions',
      'POST /v1/subscriptions',
    ],
  );
  assert.equal(calls[1].headers.authorization, 'Bearer tok');
  const posted = calls
    .filter((c) => c.method === 'POST' && c.url.endsWith('/v1/subscriptions'))
    .map((c) => JSON.parse(c.body));
  assert.deepEqual(posted, [
    { target: TARGET, eventName: 'analysis_completed', secret: 'sign-me' },
    { target: TARGET, eventName: 'analysis_failed', secret: 'sign-me' },
  ]);
  const output = lines.join('\n');
  assert.match(
    output,
    /id-analysis_completed\s+analysis_completed\s+https:\/\/new\.trycloudflare\.com/,
  );
  assert.doesNotMatch(output, /sign-me|csecret|tok\b/);
});

test('delete removes only the rows whose path matches; ALGOAN_API_BASE_URL is honoured', async () => {
  const { calls, fetchImpl } = stub([
    { id: 'a', eventName: 'analysis_failed', target: TARGET },
    { id: 'b', eventName: 'analysis_failed', target: 'https://x.example.com/other' },
  ]);
  await run(
    ['delete', '--path', '/v1/webhooks/algoan_credit/callback'],
    { ...ENV, ALGOAN_API_BASE_URL: 'http://localhost:9/' },
    fetchImpl,
    () => {},
  );
  assert.deepEqual(
    calls.filter((c) => c.method === 'DELETE').map((c) => c.url),
    ['http://localhost:9/v1/subscriptions/a'],
  );
});

test("a failure carries Algoan's { code, message }", async () => {
  const fetchImpl = async () => reply(401, { code: 'UNAUTHORIZED', message: 'bad client' });
  await assert.rejects(
    run(['list'], ENV, fetchImpl, () => {}),
    /"code":"UNAUTHORIZED".*"message":"bad client"/,
  );
});

test('rebaseBankData puts the latest balanceDate on today 12:00 UTC and shifts transaction dates equally', () => {
  const input = {
    accounts: [
      {
        balanceDate: '2026-10-14T12:00:00.000Z',
        transactions: [
          {
            dates: { debitedAt: '2026-10-10T08:30:00.000Z', bookedAt: '2026-10-11T08:30:00.000Z' },
          },
        ],
      },
    ],
  };
  const out = rebaseBankData(input, new Date('2026-10-20T03:00:00Z'));
  assert.equal(out.accounts[0].balanceDate, '2026-10-20T12:00:00.000Z');
  assert.deepEqual(out.accounts[0].transactions[0].dates, {
    debitedAt: '2026-10-16T08:30:00.000Z',
    bookedAt: '2026-10-17T08:30:00.000Z',
  });
  assert.equal(input.accounts[0].balanceDate, '2026-10-14T12:00:00.000Z');
});
