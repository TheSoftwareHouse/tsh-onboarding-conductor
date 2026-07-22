const { fork, spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const process = require('node:process');

const fixtureScript = path.join(__dirname, 'test-engine-fixture.cjs');
const packageRoot = path.join(__dirname, '..');
const envFilePath = path.join(packageRoot, '.env.development.local');
const panelOrigin = process.env.BASE_URL || 'http://localhost:5173';

function waitForServer(url) {
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
  const fixture = fork(fixtureScript, [], {
    cwd: packageRoot,
    env: {
      ...process.env,
      PANEL_ORIGIN: panelOrigin,
    },
    stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
  });

  const requests = [];
  let fixtureUrl = null;
  let playwrightProcess = null;
  let completed = false;
  let previousEnvFile = null;

  const fixtureReady = new Promise((resolve, reject) => {
    fixture.once('message', (message) => {
      if (!message || typeof message !== 'object' || message.type !== 'ready') {
        reject(new Error('Engine fixture did not report readiness.'));
        return;
      }

      fixtureUrl = message.url;
      resolve();
    });

    fixture.once('error', reject);
    fixture.once('exit', (code, signal) => {
      if (!completed) {
        reject(
          new Error(
            `Engine fixture exited before Playwright finished (code=${code}, signal=${signal}).`,
          ),
        );
      }
    });
  });

  fixture.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
  });

  fixture.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });

  fixture.on('message', (message) => {
    if (!message || typeof message !== 'object') {
      return;
    }

    if (message.type === 'request') {
      requests.push(message.request);
      return;
    }

    if (message.type === 'unexpected-request') {
      process.stderr.write(
        `Engine fixture received an unexpected request: ${JSON.stringify(message.request)}\n`,
      );

      if (playwrightProcess && !playwrightProcess.killed) {
        playwrightProcess.kill('SIGTERM');
      }
    }
  });

  const shutdown = async (signal) => {
    completed = true;

    try {
      if (previousEnvFile === null) {
        await fs.unlink(envFilePath);
      } else {
        await fs.writeFile(envFilePath, previousEnvFile);
      }
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'ENOENT') {
        throw error;
      }
    }

    if (playwrightProcess && !playwrightProcess.killed) {
      playwrightProcess.kill(signal || 'SIGTERM');
    }

    if (!fixture.killed) {
      fixture.kill(signal || 'SIGTERM');
    }
  };

  const handleSignal = async (signal) => {
    await shutdown(signal);
    process.exit(normalizeExitCode(undefined, signal));
  };

  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  try {
    await fixtureReady;
    await waitForServer(fixtureUrl);

    try {
      previousEnvFile = await fs.readFile(envFilePath, 'utf8');
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'ENOENT') {
        throw error;
      }

      previousEnvFile = null;
    }

    await fs.writeFile(envFilePath, `VITE_ENGINE_BASE_URL=${fixtureUrl}\n`);

    playwrightProcess = spawn(
      process.env.npm_execpath || 'pnpm',
      ['exec', 'playwright', 'test', ...process.argv.slice(2)],
      {
        cwd: packageRoot,
        env: {
          ...process.env,
          BASE_URL: panelOrigin,
          VITE_ENGINE_BASE_URL: fixtureUrl,
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

    const invalidRequests = requests.filter(
      (request) =>
        request.origin !== panelOrigin ||
        request.pathname !== '/v1/admin/onboardings' ||
        request.search !== '' ||
        !['GET', 'OPTIONS'].includes(request.method),
    );

    if (invalidRequests.length > 0) {
      throw new Error(
        `Engine fixture observed invalid requests: ${JSON.stringify(invalidRequests)}`,
      );
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
