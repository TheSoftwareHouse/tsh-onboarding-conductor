#!/usr/bin/env node
'use strict';

const USAGE = `Manage the Algoan webhook subscriptions the algoan_credit connector needs.

Usage:
  node scripts/algoan-subscriptions.cjs list
  node scripts/algoan-subscriptions.cjs create --target <url> [--events analysis_completed,analysis_failed]
                                               [--secret <value> | --secret-from-connector]
  node scripts/algoan-subscriptions.cjs delete --path /v1/webhooks/algoan_credit/callback

create makes one subscription per event, signed with the secret, after deleting the existing
subscriptions whose target path equals the new target's path (stale tunnel hosts).
delete removes every subscription whose target path equals --path.

Credentials (read from the environment; the engine's admin API masks connector secrets, so
--secret-from-connector means "use ALGOAN_CALLBACK_SIGNING_SECRET", the value stored as the
connector's callbackSigningSecret):
  ALGOAN_CLIENT_ID, ALGOAN_CLIENT_SECRET   OAuth client_credentials for the sandbox project
  ALGOAN_CALLBACK_SIGNING_SECRET           signing secret for create
  ALGOAN_API_BASE_URL                      default https://api.algoan.com

Secrets and tokens are never printed. Exits non-zero with Algoan's { code, message } on failure.
`;

const DEFAULT_BASE = 'https://api.algoan.com';
const DEFAULT_EVENTS = ['analysis_completed', 'analysis_failed'];

class CliError extends Error {}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, events: DEFAULT_EVENTS };
  if (!command || command === '--help' || command === '-h') {
    return { command: 'help' };
  }
  if (!['list', 'create', 'delete'].includes(command)) {
    throw new CliError(`unknown command '${command}'`);
  }
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const value = () => {
      const next = rest[(i += 1)];
      if (next === undefined || next.startsWith('--')) {
        throw new CliError(`${flag} needs a value`);
      }
      return next;
    };
    if (flag === '--target') options.target = value();
    else if (flag === '--path') options.path = value();
    else if (flag === '--events')
      options.events = value()
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean);
    else if (flag === '--secret') options.secret = value();
    else if (flag === '--secret-from-connector') options.secretFromConnector = true;
    else throw new CliError(`unknown flag '${flag}'`);
  }
  if (command === 'create') {
    if (!options.target) throw new CliError('create needs --target <url>');
    if (!URL.canParse(options.target))
      throw new CliError(`--target is not a URL: ${options.target}`);
    if (!options.events.length) throw new CliError('--events is empty');
    if (!options.secret && !options.secretFromConnector) {
      throw new CliError('create needs --secret <value> or --secret-from-connector');
    }
  }
  if (command === 'delete' && !options.path) throw new CliError('delete needs --path <path>');
  return options;
}

function pathOf(target) {
  return URL.canParse(target) ? new URL(target).pathname : target;
}

function createApi(env, fetchImpl) {
  const base = (env.ALGOAN_API_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
  let token;

  async function call(method, path, { body, form, auth = true } = {}) {
    const headers = {};
    if (auth) headers.authorization = `Bearer ${await getToken()}`;
    let payload;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(form).toString();
    } else if (body) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const response = await fetchImpl(`${base}${path}`, { method, headers, body: payload });
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!response.ok) {
      const code = json?.code ?? `HTTP_${response.status}`;
      const message = json?.message ?? (text.slice(0, 200) || response.statusText);
      throw new CliError(`Algoan ${method} ${path} failed: ${JSON.stringify({ code, message })}`);
    }
    return json;
  }

  async function getToken() {
    if (token) return token;
    if (!env.ALGOAN_CLIENT_ID || !env.ALGOAN_CLIENT_SECRET) {
      throw new CliError('set ALGOAN_CLIENT_ID and ALGOAN_CLIENT_SECRET in the environment');
    }
    const json = await call('POST', '/v1/oauth/token', {
      auth: false,
      form: {
        grant_type: 'client_credentials',
        client_id: env.ALGOAN_CLIENT_ID,
        client_secret: env.ALGOAN_CLIENT_SECRET,
      },
    });
    token = json?.access_token;
    if (!token) throw new CliError('Algoan answered the token call without an access_token');
    return token;
  }

  return {
    list: () => call('GET', '/v1/subscriptions'),
    create: (target, eventName, secret) =>
      call('POST', '/v1/subscriptions', { body: { target, eventName, secret } }),
    remove: (id) => call('DELETE', `/v1/subscriptions/${encodeURIComponent(id)}`),
  };
}

function formatTable(rows) {
  const columns = [
    ['id', 'ID'],
    ['eventName', 'EVENT'],
    ['target', 'TARGET'],
    ['status', 'STATUS'],
  ];
  const cells = rows.map((row) => columns.map(([key]) => String(row[key] ?? '')));
  const widths = columns.map(([, title], i) =>
    Math.max(title.length, ...cells.map((c) => c[i].length)),
  );
  const line = (values) =>
    values
      .map((v, i) => v.padEnd(widths[i]))
      .join('  ')
      .trimEnd();
  return [line(columns.map(([, title]) => title)), ...cells.map(line)].join('\n');
}

async function removeByPath(api, path, log) {
  const stale = (await api.list()).filter((s) => pathOf(s.target) === path);
  for (const subscription of stale) {
    await api.remove(subscription.id);
    log(`deleted ${subscription.id} (${subscription.eventName} -> ${subscription.target})`);
  }
  return stale.length;
}

async function run(argv, env, fetchImpl, out = (text) => process.stdout.write(`${text}\n`)) {
  const options = parseArgs(argv);
  if (options.command === 'help') {
    out(USAGE.trimEnd());
    return 0;
  }
  const api = createApi(env, fetchImpl);

  if (options.command === 'list') {
    out(formatTable(await api.list()));
  } else if (options.command === 'delete') {
    const count = await removeByPath(api, options.path, out);
    out(`${count} subscription(s) deleted`);
  } else {
    const secret = options.secret ?? env.ALGOAN_CALLBACK_SIGNING_SECRET;
    if (!secret) {
      throw new CliError(
        '--secret-from-connector reads ALGOAN_CALLBACK_SIGNING_SECRET, which is not set',
      );
    }
    await removeByPath(api, pathOf(options.target), out);
    const created = [];
    for (const eventName of options.events) {
      created.push(await api.create(options.target, eventName, secret));
    }
    out(formatTable(created));
  }
  return 0;
}

if (require.main === module) {
  run(process.argv.slice(2), process.env, fetch).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`algoan-subscriptions: ${error.message}\n`);
      if (error instanceof CliError && /unknown|needs|is not|is empty/.test(error.message)) {
        process.stderr.write('Run with --help for usage.\n');
      }
      process.exitCode = 1;
    },
  );
}

module.exports = { parseArgs, run, pathOf, formatTable, CliError };
