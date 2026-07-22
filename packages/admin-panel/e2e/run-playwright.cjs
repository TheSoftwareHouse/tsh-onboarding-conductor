const { fork, spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const process = require('node:process');

const upstreamScript = path.join(__dirname, 'mock-upstream.cjs');
const packageRoot = path.join(__dirname, '..');

function waitForUpstreamConnection(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const socket = net.createConnection(
      { host: parsedUrl.hostname, port: Number(parsedUrl.port) },
      () => {
        socket.end();
        resolve();
      },
    );

    socket.once('error', reject);
  });
}

function normalizeExitCode(code, signal) {
  if (typeof code === 'number') {
    return code;
  }

  if (signal === 'SIGINT') {
    return 130;
  }

  if (signal === 'SIGTERM') {
    return 143;
  }

  return 1;
}

async function main() {
  const upstream = fork(upstreamScript, [], {
    cwd: packageRoot,
    env: { ...process.env },
    stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
  });

  const requests = [];
  let upstreamUrl = null;
  let playwrightProcess = null;
  let completed = false;

  const upstreamReady = new Promise((resolve, reject) => {
    upstream.once('message', (message) => {
      if (!message || typeof message !== 'object' || message.type !== 'ready') {
        reject(new Error('Mock upstream did not report readiness.'));
        return;
      }

      upstreamUrl = message.url;
      resolve();
    });

    upstream.once('error', reject);
    upstream.once('exit', (code, signal) => {
      if (!completed) {
        reject(
          new Error(
            `Mock upstream exited before Playwright finished (code=${code}, signal=${signal}).`,
          ),
        );
      }
    });
  });

  upstream.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
  });

  upstream.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });

  upstream.on('message', (message) => {
    if (!message || typeof message !== 'object') {
      return;
    }

    if (message.type === 'request') {
      requests.push(message.request);
      return;
    }

    if (message.type === 'unexpected-request') {
      process.stderr.write(
        `Mock upstream received an unexpected request: ${JSON.stringify(message.request)}\n`,
      );

      if (playwrightProcess && !playwrightProcess.killed) {
        playwrightProcess.kill('SIGTERM');
      }
    }
  });

  const shutdown = async (signal) => {
    completed = true;

    if (playwrightProcess && !playwrightProcess.killed) {
      playwrightProcess.kill(signal || 'SIGTERM');
    }

    if (!upstream.killed) {
      upstream.kill(signal || 'SIGTERM');
    }
  };

  const handleSignal = async (signal) => {
    await shutdown(signal);
    process.exit(normalizeExitCode(undefined, signal));
  };

  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  try {
    await upstreamReady;
    await waitForUpstreamConnection(upstreamUrl);

    playwrightProcess = spawn(
      process.env.npm_execpath || 'pnpm',
      ['exec', 'playwright', 'test', ...process.argv.slice(2)],
      {
        cwd: packageRoot,
        env: {
          ...process.env,
          ADMIN_PANEL_PROXY_TARGET: upstreamUrl,
        },
        stdio: 'inherit',
      },
    );

    const playwrightExit = await new Promise((resolve, reject) => {
      playwrightProcess.once('exit', (code, signal) => {
        resolve({ code, signal });
      });

      playwrightProcess.once('error', reject);
    });

    completed = true;

    await shutdown('SIGTERM');

    if (requests.length !== 1) {
      throw new Error(`Mock upstream observed ${requests.length} requests instead of exactly 1.`);
    }

    const [request] = requests;

    if (
      request.method !== 'GET' ||
      request.pathname !== '/v1/admin/onboardings' ||
      request.search !== ''
    ) {
      throw new Error(`Mock upstream observed an invalid request: ${JSON.stringify(request)}`);
    }

    process.exit(normalizeExitCode(playwrightExit.code, playwrightExit.signal));
  } catch (error) {
    completed = true;
    await shutdown('SIGTERM');
    process.stderr.write(
      `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}

void main();
