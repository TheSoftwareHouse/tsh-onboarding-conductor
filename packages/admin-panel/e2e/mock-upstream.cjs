const http = require('node:http');
const { URL } = require('node:url');

const HOST = '127.0.0.1';
const PROXY_PATH = '/v1/admin/onboardings';

const FIXTURE = [
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
    context: { hidden: 'proxy fixture context' },
  },
];

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function requestRecord(request) {
  const url = new URL(request.url || '/', 'http://localhost');

  return {
    method: request.method || 'UNKNOWN',
    pathname: url.pathname,
    search: url.search,
  };
}

const server = http.createServer((request, response) => {
  const record = requestRecord(request);

  if (typeof process.send === 'function') {
    process.send({ type: 'request', request: record });
  }

  const isAllowedRequest =
    record.method === 'GET' && record.pathname === PROXY_PATH && record.search === '';

  if (!isAllowedRequest) {
    if (typeof process.send === 'function') {
      process.send({ type: 'unexpected-request', request: record });
    }

    sendJson(response, 400, {
      error: 'Unexpected request',
      request: record,
    });
    return;
  }

  sendJson(response, 200, FIXTURE);
});

server.listen(0, HOST, () => {
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Mock upstream failed to bind to an ephemeral loopback port.');
  }

  const url = `http://${HOST}:${address.port}`;

  if (typeof process.send === 'function') {
    process.send({ type: 'ready', url });
  } else {
    process.stdout.write(`${url}\n`);
  }
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
