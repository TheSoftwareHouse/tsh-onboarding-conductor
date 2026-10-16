#!/usr/bin/env node
'use strict';

/**
 * Runs the BNPL demo on the host: the demo BFF (`@tsh/demo-bff`, nest --watch) and the demo web
 * app (`@tsh/demo-web`, Vite) side by side, both configured from the repository's `.env`, against
 * an engine that is already running (`pnpm stack:up`).
 *
 *   pnpm demo:dev            start the BFF and the web app
 *   pnpm demo:dev --tunnel   also open a cloudflared tunnel to the engine and point the Algoan
 *                            webhook subscriptions at it (real-sandbox runs need that);
 *                            `pnpm demo:dev:tunnel` is the same command with the flag
 *   pnpm demo:dev --help
 *
 * Ctrl+C stops everything; with --tunnel the subscriptions created for this tunnel are deleted
 * again on the way out. Secrets are read from `.env` for the subscription script only and are
 * never printed.
 */

const { spawn, spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');
const CALLBACK_PATH = '/v1/webhooks/algoan_credit/callback';
const REQUIRED = [
  'ENGINE_BASE_URL',
  'UPLOAD_PUBLIC_HOST',
  'ENGINE_REQUEST_TIMEOUT_MS',
  'DEMO_BFF_PORT',
  'DEMO_WEB_ORIGIN',
  'VITE_BNPL_BFF_BASE_URL',
  'BNPL_WORKFLOW_ID',
  'PERSONAS_DIR',
];
const TUNNEL_REQUIRED = [
  'ALGOAN_CLIENT_ID',
  'ALGOAN_CLIENT_SECRET',
  'ALGOAN_CALLBACK_SIGNING_SECRET',
];
const COLORS = { bff: '\x1b[36m', web: '\x1b[35m', tunnel: '\x1b[33m', demo: '\x1b[32m' };
const RESET = '\x1b[0m';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(
    'Usage: pnpm demo:dev [--tunnel]   (pnpm demo:dev:tunnel is the same with the flag)\n\n' +
      'Starts the demo BFF and the demo web app from .env against ENGINE_BASE_URL.\n' +
      '--tunnel also runs `cloudflared tunnel --url <ENGINE_BASE_URL>` and recreates the Algoan\n' +
      `webhook subscriptions for https://<tunnel-host>${CALLBACK_PATH}.`,
  );
  process.exit(0);
}
const unknown = args.filter((a) => a !== '--tunnel');
if (unknown.length > 0) {
  console.error(`demo-dev: unknown argument ${unknown.join(' ')}; see --help`);
  process.exit(2);
}
const withTunnel = args.includes('--tunnel');

function log(tag, line) {
  const color = COLORS[tag] ?? '';
  process.stdout.write(`${color}[${tag}]${RESET} ${line}\n`);
}

function fail(message) {
  console.error(`demo-dev: ${message}`);
  process.exit(1);
}

// --- configuration -----------------------------------------------------------------------

if (!existsSync(ENV_FILE)) {
  fail('.env not found; run `cp .env.dist .env` first');
}
// Like `node --env-file`: fills in what the shell has not already set.
process.loadEnvFile(ENV_FILE);

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  fail(`missing in .env: ${missing.join(', ')} (the BNPL demo block of .env.dist lists them)`);
}
if (withTunnel) {
  const missingSecrets = TUNNEL_REQUIRED.filter((name) => !process.env[name]);
  if (missingSecrets.length > 0) {
    fail(`--tunnel needs ${missingSecrets.join(', ')} in .env`);
  }
}

const engine = process.env.ENGINE_BASE_URL.replace(/\/+$/, '');
const bffPort = process.env.DEMO_BFF_PORT;
const webOrigin = process.env.DEMO_WEB_ORIGIN;

// --- preflight -----------------------------------------------------------------------------

async function engineIsUp() {
  try {
    const response = await fetch(`${engine}/v1/health/live`, { signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function workflowIsPublished(workflowId) {
  // Public route: 404 WORKFLOW_NOT_FOUND when the id is unknown, 400/422 otherwise. Any other
  // outcome is reported but does not block the start.
  try {
    const response = await fetch(`${engine}/v1/onboardings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workflowId }),
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 404) return false;
    return true;
  } catch {
    return true;
  }
}

// --- children --------------------------------------------------------------------------------

const children = new Map();
// A child that dies is started again (a `git stash` or a branch switch briefly removes the files a
// watcher serves); only a crash loop stops the run.
const RESTART_LIMIT = 5;
const RESTART_WINDOW_MS = 120000;
const RESTART_DELAY_MS = 3000;
const restarts = new Map();
let shuttingDown = false;

function pipe(tag, stream) {
  let rest = '';
  stream.on('data', (chunk) => {
    rest += chunk.toString();
    const lines = rest.split(/\r?\n/);
    rest = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length > 0) log(tag, line);
    }
  });
  stream.on('end', () => {
    if (rest.length > 0) log(tag, rest);
  });
}

function start(tag, command, commandArgs, options = {}) {
  const launch = () => start(tag, command, commandArgs, options);
  const child = spawn(command, commandArgs, {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group, so one signal reaches pnpm and the node/vite process it wraps.
    detached: process.platform !== 'win32',
    shell: process.platform === 'win32',
    ...options,
  });
  pipe(tag, child.stdout);
  pipe(tag, child.stderr);
  children.set(tag, child);
  child.on('exit', (code, signal) => {
    children.delete(tag);
    if (shuttingDown) return;
    const now = Date.now();
    const recent = (restarts.get(tag) ?? []).filter((at) => now - at < RESTART_WINDOW_MS);
    if (recent.length >= RESTART_LIMIT) {
      log(
        'demo',
        `${tag} exited (${signal ?? `code ${code}`}) ${recent.length} times in two minutes; stopping the rest`,
      );
      void shutdown(code ?? 1);
      return;
    }
    restarts.set(tag, [...recent, now]);
    log(
      'demo',
      `${tag} exited (${signal ?? `code ${code}`}); restarting it in ${RESTART_DELAY_MS / 1000} s`,
    );
    setTimeout(() => {
      if (!shuttingDown) launch();
    }, RESTART_DELAY_MS);
  });
  return child;
}

function kill(child, signal) {
  try {
    if (child.pid && process.platform !== 'win32') {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    // already gone
  }
}

let subscriptionsCreated = false;

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (subscriptionsCreated) {
    log('demo', 'deleting the Algoan subscriptions created for this tunnel');
    spawnSync(
      process.execPath,
      [path.join(__dirname, 'algoan-subscriptions.cjs'), 'delete', '--path', CALLBACK_PATH],
      { cwd: ROOT, env: process.env, stdio: 'inherit' },
    );
  }
  for (const child of children.values()) kill(child, 'SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 2000));
  for (const child of children.values()) kill(child, 'SIGKILL');
  process.exit(code);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

// --- tunnel ----------------------------------------------------------------------------------

function startTunnel() {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('cloudflared', ['tunnel', '--url', engine], {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    children.set('tunnel', child);
    let found = false;
    const watch = (chunk) => {
      const text = chunk.toString();
      // cloudflared narrates every connection at INF level; only its warnings and errors matter.
      for (const line of text.split(/\r?\n/)) {
        if (/ (ERR|WRN) /.test(line)) log('tunnel', line);
      }
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !found) {
        found = true;
        resolvePromise(match[0]);
      }
    };
    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
    child.on('error', (error) =>
      reject(new Error(`cloudflared could not start: ${error.message}`)),
    );
    child.on('exit', (code, signal) => {
      children.delete('tunnel');
      if (!found)
        reject(new Error(`cloudflared exited before publishing a URL (${signal ?? code})`));
      else if (!shuttingDown) {
        log('demo', 'the tunnel exited; stopping the rest');
        void shutdown(1);
      }
    });
    setTimeout(() => {
      if (!found) reject(new Error('cloudflared did not publish a URL within 30 s'));
    }, 30000).unref();
  });
}

async function waitFor(url, label, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return true;
    } catch {
      // not yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  log('demo', `${label} did not answer at ${url} within ${attempts} s`);
  return false;
}

// --- main ------------------------------------------------------------------------------------

async function main() {
  log('demo', `engine ${engine}, workflow ${process.env.BNPL_WORKFLOW_ID}`);
  if (!(await engineIsUp())) {
    fail(`no engine answers at ${engine}/v1/health/live; start it with \`pnpm stack:up\``);
  }
  if (!(await workflowIsPublished(process.env.BNPL_WORKFLOW_ID))) {
    fail(
      `the engine at ${engine} knows no published workflow '${process.env.BNPL_WORKFLOW_ID}' ` +
        '(BNPL_WORKFLOW_ID in .env)',
    );
  }

  if (withTunnel) {
    const tunnelUrl = await startTunnel();
    log('demo', `tunnel ${tunnelUrl} -> ${engine} (waiting for its DNS to propagate)`);
    // A quick tunnel's hostname can take a minute or two to resolve after cloudflared prints it.
    if (!(await waitFor(`${tunnelUrl}/v1/health/live`, 'the engine through the tunnel', 180))) {
      await shutdown(1);
      return;
    }
    const target = `${tunnelUrl}${CALLBACK_PATH}`;
    log('demo', `creating the Algoan subscriptions for ${target}`);
    const result = spawnSync(
      process.execPath,
      [
        path.join(__dirname, 'algoan-subscriptions.cjs'),
        'create',
        '--target',
        target,
        '--events',
        'analysis_completed,analysis_failed',
        '--secret-from-connector',
      ],
      { cwd: ROOT, env: process.env, stdio: 'inherit' },
    );
    if ((result.status ?? 1) !== 0) {
      log('demo', 'could not create the Algoan subscriptions');
      await shutdown(1);
      return;
    }
    subscriptionsCreated = true;
  }

  start('bff', 'pnpm', ['--filter', '@tsh/demo-bff', 'start:dev']);
  start('web', 'pnpm', ['--filter', '@tsh/demo-web', 'dev']);

  const bffUp = await waitFor(`http://localhost:${bffPort}/health`, 'the demo BFF');
  const webUp = await waitFor(webOrigin, 'the demo web app', 30);
  if (bffUp && webUp) {
    log(
      'demo',
      `ready: open ${webOrigin} (BFF http://localhost:${bffPort}, admin panel ${engine}/)`,
    );
    log('demo', 'Ctrl+C stops everything');
  }
}

main().catch((error) => {
  console.error(`demo-dev: ${error.message}`);
  void shutdown(1);
});
