#!/usr/bin/env node

const { spawn, spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

function runStep(command, args, description) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    const error = new Error(`${description} failed with exit code ${result.status ?? 1}`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

function startService(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });

  if (!child.pid) {
    throw new Error(`Unable to start service: ${command} ${args.join(' ')}`);
  }

  return child;
}

function stopService(child) {
  if (!child || child.killed) {
    return;
  }

  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        shell: true,
      });
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    // Ignore teardown errors when process already exited.
  }
}

async function waitForHealthcheck(url, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Service is still starting.
    }

    await new Promise((resolvePromise) => {
      setTimeout(resolvePromise, 1_000);
    });
  }

  throw new Error(`Timed out waiting for healthcheck: ${url}`);
}

const repoRoot = resolve(__dirname, '..');
const engineWorkingDirectory = resolve(repoRoot, 'packages/engine');
const demoBffWorkingDirectory = resolve(repoRoot, 'packages/demo-bff');

const engineEnvironment = {
  ...process.env,
  MODE: process.env.MODE || 'all',
  PORT: process.env.PORT || '3000',
  NODE_ENV: process.env.NODE_ENV || 'development',
  WORKFLOWS_DIR: process.env.WORKFLOWS_DIR || resolve(repoRoot, 'workflows'),
  DATABASE_URL:
    process.env.DATABASE_URL ||
    'postgres://orchestrator:orchestrator_pass@127.0.0.1:5432/orchestrator?sslmode=disable',
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379/0',
  STORAGE_DRIVER: process.env.STORAGE_DRIVER || 's3',
  STORAGE_S3_BUCKET: process.env.STORAGE_S3_BUCKET || 'orchestrator-files',
  STORAGE_S3_REGION: process.env.STORAGE_S3_REGION || 'us-east-1',
  STORAGE_S3_ENDPOINT: process.env.STORAGE_S3_ENDPOINT || 'http://127.0.0.1:9000',
  STORAGE_S3_FORCE_PATH_STYLE: process.env.STORAGE_S3_FORCE_PATH_STYLE || 'true',
  STORAGE_S3_ACCESS_KEY_ID: process.env.STORAGE_S3_ACCESS_KEY_ID || 'minioadmin',
  STORAGE_S3_SECRET_ACCESS_KEY: process.env.STORAGE_S3_SECRET_ACCESS_KEY || 'minioadmin',
  ADMIN_PANEL_ORIGIN: process.env.ADMIN_PANEL_ORIGIN || 'http://127.0.0.1:5174',
  ENGINE_SERVICE_SECRET: process.env.ENGINE_SERVICE_SECRET || 'change-me',
};

const demoBffEnvironment = {
  ...process.env,
  PORT: process.env.DEMO_BFF_PORT || process.env.PORT_DEMO_BFF || '3001',
  NODE_ENV: process.env.NODE_ENV_DEMO_BFF || 'development',
  ENGINE_BASE_URL: process.env.ENGINE_BASE_URL || 'http://127.0.0.1:3000',
  ENGINE_SERVICE_SECRET: process.env.ENGINE_SERVICE_SECRET || 'change-me',
  DEMO_WORKFLOW_ID: process.env.DEMO_WORKFLOW_ID || 'base',
};

const backgroundServices = [];
let failure;

function registerSignalHandlers() {
  const cleanupAndExit = (signal) => {
    for (const service of [...backgroundServices].reverse()) {
      stopService(service);
    }
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };

  process.on('SIGINT', cleanupAndExit);
  process.on('SIGTERM', cleanupAndExit);
}

async function run() {
  registerSignalHandlers();

  const engineProcess = startService(
    'node',
    ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register', 'src/main.ts'],
    {
      cwd: engineWorkingDirectory,
      env: engineEnvironment,
      detached: process.platform !== 'win32',
    },
  );
  backgroundServices.push(engineProcess);

  await waitForHealthcheck('http://127.0.0.1:3000/v1/health/live', 120_000);

  const demoBffProcess = startService(
    'node',
    ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register', 'src/main.ts'],
    {
      cwd: demoBffWorkingDirectory,
      env: demoBffEnvironment,
      detached: process.platform !== 'win32',
    },
  );
  backgroundServices.push(demoBffProcess);

  await waitForHealthcheck('http://127.0.0.1:3001/v1/health/live', 120_000);

  runStep(
    'pnpm',
    ['-r', '--workspace-concurrency=1', '--if-present', 'run', 'test:e2e'],
    'Run e2e suites',
  );
}

run()
  .catch((error) => {
    failure = error;
  })
  .finally(() => {
    for (const service of [...backgroundServices].reverse()) {
      stopService(service);
    }

    if (failure) {
      process.exitCode = failure.exitCode ?? 1;
      console.error(failure);
    }
  });
