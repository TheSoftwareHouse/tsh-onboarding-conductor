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
 * below: this runner is CommonJS and cannot import the TypeScript source.
 */
const MAX_LIMIT = 100;
/**
 * Every status the panel offers in its filter dropdown. Kept in step by hand with
 * `ADMIN_ONBOARDING_STATUSES` in `src/features/onboarding/types/admin-onboarding.ts` — this
 * runner is CommonJS and cannot import the TypeScript source. A status missing here is rejected
 * as an invalid query, so selecting it in the panel would fail the run rather than exercise it.
 */
const VALID_STATUSES = new Set([
  'awaiting_user',
  'awaiting_manual_review',
  'approved',
  'rejected',
  'invalid',
]);

/**
 * Marks the specs that need the sign-in gate active. They run in their own pass against a dev
 * server built with sign-in on; every other spec runs with it off.
 */
const AUTH_ENABLED_TAG = '@auth-enabled';

// Public identifiers for a directory that does not exist. The gate-enabled pass never completes a
// sign-in, so nothing here has to resolve — it exists so the panel can construct its MSAL client.
const FAKE_CLIENT_ID = '00000000-0000-0000-0000-0000000000c1';
const FAKE_TENANT_ID = '00000000-0000-0000-0000-0000000000e1';
const FAKE_API_SCOPE = '00000000-0000-0000-0000-0000000000c1/.default';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ONBOARDINGS_PATH = '/v1/onboardings';
const CONNECTOR_SETTINGS_PATH = '/v1/admin/connectors';

/**
 * Every request the panel is allowed to make, checked here as well as in the fixture: the two
 * processes are separate, so this is what turns a request the panel should not have sent into a
 * failed run rather than a fixture 400 nobody reads.
 */
function isValidRequest(request) {
  if (request.pathname === ONBOARDINGS_PATH) {
    return ['GET', 'OPTIONS'].includes(request.method) && isValidSearch(request.search);
  }

  if (request.search !== '') {
    return false;
  }

  if (request.pathname === CONNECTOR_SETTINGS_PATH) {
    return ['GET', 'OPTIONS'].includes(request.method);
  }

  // One connector's settings, written under its connector type.
  if (request.pathname.startsWith(`${CONNECTOR_SETTINGS_PATH}/`)) {
    return ['PUT', 'OPTIONS'].includes(request.method);
  }

  return false;
}

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

    if (key === 'page' && (!/^\d+$/.test(value) || Number.parseInt(value, 10) < 1)) {
      return false;
    }

    if (
      key === 'limit' &&
      (!/^\d+$/.test(value) ||
        Number.parseInt(value, 10) < 1 ||
        Number.parseInt(value, 10) > MAX_LIMIT)
    ) {
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

function resolvePlaywrightCommand(additionalArgs = []) {
  const playwrightArgs = [
    'exec',
    'playwright',
    'test',
    ...additionalArgs,
    ...process.argv.slice(2),
  ];
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

    /**
     * Vite bakes VITE_* into the bundle when the dev server boots, so whether the sign-in gate is
     * active is a property of the server rather than of an individual test. Covering both states
     * therefore means two passes, each with its own dev server, selected by tag.
     */
    const runPlaywright = async (authEnabled, grepArgs) => {
      await fs.writeFile(
        envFilePath,
        [
          `VITE_ENGINE_API_BASE_URL=${fixtureUrl}`,
          `VITE_AUTH_ENABLED=${authEnabled}`,
          ...(authEnabled
            ? [
                `VITE_AZURE_CLIENT_ID=${FAKE_CLIENT_ID}`,
                `VITE_AZURE_TENANT_ID=${FAKE_TENANT_ID}`,
                `VITE_AZURE_API_SCOPE=${FAKE_API_SCOPE}`,
                // Blanked rather than omitted. Vite also loads the developer's own .env, so a
                // real redirect URI configured there would otherwise decide what this suite
                // asserts, and the run would pass or fail per machine.
                'VITE_AZURE_REDIRECT_URI=',
              ]
            : []),
          '',
        ].join('\n'),
      );

      const playwrightCommand = resolvePlaywrightCommand(grepArgs);

      playwrightProcess = spawn(playwrightCommand.command, playwrightCommand.args, {
        cwd: packageRoot,
        env: {
          ...process.env,
          BASE_URL: panelOrigin,
          VITE_ENGINE_API_BASE_URL: fixtureUrl,
          VITE_AUTH_ENABLED: String(authEnabled),
          ...(authEnabled
            ? {
                VITE_AZURE_CLIENT_ID: FAKE_CLIENT_ID,
                VITE_AZURE_TENANT_ID: FAKE_TENANT_ID,
                VITE_AZURE_API_SCOPE: FAKE_API_SCOPE,
                VITE_AZURE_REDIRECT_URI: '',
              }
            : {}),
        },
        stdio: 'inherit',
      });

      return new Promise((resolve, reject) => {
        playwrightProcess.once('exit', (code, signal) => {
          resolve({ code, signal });
        });

        playwrightProcess.once('error', reject);
      });
    };

    // Pass 1: the gate switched off, which is how the onboarding-table suites reach the fixture.
    const mainExit = await runPlaywright(false, ['--grep-invert', AUTH_ENABLED_TAG]);

    let playwrightExit = mainExit;

    // Pass 2: the gate switched on, covering the one behaviour the first pass cannot reach.
    if (normalizeExitCode(mainExit.code, mainExit.signal) === 0) {
      playwrightExit = await runPlaywright(true, ['--grep', AUTH_ENABLED_TAG]);
    }

    completed = true;

    await shutdown('SIGTERM');

    const invalidRequests = requests.filter(
      (request) => request.origin !== panelOrigin || !isValidRequest(request),
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
