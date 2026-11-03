import { parseArgs } from 'node:util';
import type { SeedOptions } from './seed/run-seed';

/** Where each option falls back to when its flag is absent: an environment variable, then a default. */
export const DEFAULTS = {
  seed: 42,
  count: 8,
  engineUrl: 'http://localhost:3000',
  mailhogUrl: 'http://localhost:8025',
  storagePort: '3900',
} as const;

export const USAGE = `Usage: pnpm onboardings:seed -- [options]

Seeds a deterministic population of synthetic onboardings through the engine's public API and
writes packages/onboarding-seeder/out/manifest.json. Needs the stack running (pnpm stack:up).

Options:
  --seed <n>            Seed for every generated value (default ${DEFAULTS.seed}); one seed, one population.
  --count <n>           How many approved onboardings (default ${DEFAULTS.count}); other scenario families have fixed sizes.
  --engine <url>        Engine base URL (env ENGINE_URL, default ${DEFAULTS.engineUrl}).
  --mailhog <url>       MailHog base URL, where email codes are read (env MAILHOG_URL, default ${DEFAULTS.mailhogUrl}).
  --storage-url <url>   Object storage the document upload is posted to (env STORAGE_URL,
                        default http://localhost:<STORAGE_S3_PORT, ${DEFAULTS.storagePort}>).
  --database-url <url>  Postgres, read once per parked onboarding for the mock provider's reference
                        (env DATABASE_URL); only localhost, 127.0.0.1 and postgres are accepted.
  --spread-days <n>     After seeding, move each onboarding back so it starts on a day within the last
                        <n> days (default off); review-waiting onboardings are made the oldest. Rewrites
                        timestamps in the database, so the same local hosts only.
  --help                Print this help.`;

export type CliCommand = { kind: 'help' } | { kind: 'seed'; options: SeedOptions };

/** Parses the arguments `pnpm ... seed -- <args>` forwards; `env` supplies what a flag omits. */
export function parseCliOptions(argv: readonly string[], env: NodeJS.ProcessEnv): CliCommand {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const { values } = parseArgs({
    args: [...args],
    options: {
      seed: { type: 'string' },
      count: { type: 'string' },
      engine: { type: 'string' },
      mailhog: { type: 'string' },
      'storage-url': { type: 'string' },
      'database-url': { type: 'string' },
      'spread-days': { type: 'string' },
      help: { type: 'boolean' },
    },
    strict: true,
  });

  if (values.help) {
    return { kind: 'help' };
  }

  const databaseUrl = values['database-url'] ?? env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('A database URL is required: pass --database-url or set DATABASE_URL.');
  }

  return {
    kind: 'seed',
    options: {
      seed: parseInteger('--seed', values.seed, DEFAULTS.seed),
      count: parseInteger('--count', values.count, DEFAULTS.count),
      engineUrl: values.engine ?? env.ENGINE_URL ?? DEFAULTS.engineUrl,
      mailhogUrl: values.mailhog ?? env.MAILHOG_URL ?? DEFAULTS.mailhogUrl,
      storageUrl:
        values['storage-url'] ??
        env.STORAGE_URL ??
        `http://localhost:${env.STORAGE_S3_PORT ?? DEFAULTS.storagePort}`,
      databaseUrl,
      spreadDays:
        values['spread-days'] === undefined
          ? undefined
          : parseInteger('--spread-days', values['spread-days'], 1, 1),
    },
  };
}

function parseInteger(
  flag: string,
  value: string | undefined,
  fallback: number,
  minimum = 0,
): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${flag} must be an integer of at least ${minimum}, got "${value}".`);
  }

  return parsed;
}
