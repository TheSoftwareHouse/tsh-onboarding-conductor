const { fork, spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const process = require('node:process');

const fixtureScript = path.join(__dirname, 'test-engine-fixture.cjs');
const packageRoot = path.join(__dirname, '..');
const monorepoRoot = path.join(packageRoot, '..', '..');
const envFilePath = path.join(monorepoRoot, '.env.development.local');
const panelOrigin = process.env.BASE_URL || 'http://localhost:5173';
const ALLOWED_QUERY_KEYS = new Set([
  'status',
  'workflowId',
  'workflowVersion',
  'currentStep',
  'onboardingId',
]);
// Kept in step with ADMIN_ONBOARDING_STATUSES in src/features/onboarding/types/admin-onboarding.ts;
// these harness files are plain CommonJS and cannot import the panel's TypeScript module.
const VALID_STATUSES = new Set([
  'awaiting_user',
  'awaiting_manual_review',
  'approved',
  'rejected',
  'invalid',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidSearch(search) {
  const params = new URLSearchParams(search);
  const seenKeys = new Set();

  for (const [key, value] of params.entries()) {
    if (!ALLOWED_QUERY_KEYS.has(key) || seenKeys.has(key) || value.trim().length === 0) {
      return false;
    }

    seenKeys.add(key);

    if (key === 'status' && !VALID_STATUSES.has(value)) {
      return false;
    }

    if (key === 'workflowVersion' && (!/^\d+$/.test(value) || Number.parseInt(value, 10) < 1)) {
      return false;
    }

    if (key === 'onboardingId' && !UUID_PATTERN.test(value)) {
      return false;
    }
  }

  return true;
}

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

function resolvePlaywrightCommand() {
  const playwrightArgs = ['exec', 'playwright', 'test', ...process.argv.slice(2)];
  const npmExecPath = process.env.npm_execpath;

  if (typeof npmExecPath === 'string' && npmExecPath.length > 0) {
    return {
      command: process.execPath,
      args: [npmExecPath, ...playwrightArgs],
    };
  }

  return {
    command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    args: playwrightArgs,
  };
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

    await fs.writeFile(envFilePath, `VITE_ENGINE_API_BASE_URL=${fixtureUrl}\n`);

    const playwrightCommand = resolvePlaywrightCommand();

    playwrightProcess = spawn(playwrightCommand.command, playwrightCommand.args, {
      cwd: packageRoot,
      env: {
        ...process.env,
        BASE_URL: panelOrigin,
        VITE_ENGINE_API_BASE_URL: fixtureUrl,
      },
      stdio: 'inherit',
    });

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
        request.pathname !== '/v1/onboardings' ||
        !['GET', 'OPTIONS'].includes(request.method) ||
        !isValidSearch(request.search),
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
