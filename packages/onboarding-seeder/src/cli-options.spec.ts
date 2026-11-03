import { DEFAULTS, parseCliOptions } from './cli-options';

const DATABASE_URL = 'postgres://user:pw@localhost:5436/orchestrator';

describe('parseCliOptions', () => {
  it('returns the help command', () => {
    expect(parseCliOptions(['--help'], {})).toEqual({ kind: 'help' });
  });

  it('falls back to defaults and to DATABASE_URL from the environment', () => {
    expect(parseCliOptions([], { DATABASE_URL })).toEqual({
      kind: 'seed',
      options: {
        seed: DEFAULTS.seed,
        count: DEFAULTS.count,
        engineUrl: DEFAULTS.engineUrl,
        mailhogUrl: DEFAULTS.mailhogUrl,
        storageUrl: 'http://localhost:3900',
        databaseUrl: DATABASE_URL,
      },
    });
  });

  it('lets flags override the environment, and skips the -- pnpm forwards', () => {
    const command = parseCliOptions(
      [
        '--',
        '--seed',
        '7',
        '--count',
        '3',
        '--engine',
        'http://engine:3000',
        '--mailhog',
        'http://mail:8025',
      ],
      { DATABASE_URL, ENGINE_URL: 'http://ignored', STORAGE_S3_PORT: '3902' },
    );

    expect(command).toMatchObject({
      kind: 'seed',
      options: {
        seed: 7,
        count: 3,
        engineUrl: 'http://engine:3000',
        mailhogUrl: 'http://mail:8025',
        storageUrl: 'http://localhost:3902',
      },
    });
  });

  it('leaves the spread off by default and reads --spread-days when given', () => {
    expect(parseCliOptions([], { DATABASE_URL })).toMatchObject({
      options: { spreadDays: undefined },
    });
    expect(parseCliOptions(['--spread-days', '90'], { DATABASE_URL })).toMatchObject({
      options: { spreadDays: 90 },
    });
  });

  it('rejects a spread that is not a positive integer', () => {
    expect(() => parseCliOptions(['--spread-days', '0'], { DATABASE_URL })).toThrow(
      '--spread-days',
    );
    expect(() => parseCliOptions(['--spread-days', 'x'], { DATABASE_URL })).toThrow(
      '--spread-days',
    );
  });

  it('requires a database URL', () => {
    expect(() => parseCliOptions([], {})).toThrow('database URL is required');
  });

  it('rejects a seed that is not a non-negative integer', () => {
    expect(() => parseCliOptions(['--seed', 'x'], { DATABASE_URL })).toThrow('--seed');
    expect(() => parseCliOptions(['--count', '-1'], { DATABASE_URL })).toThrow('--count');
  });

  it('rejects an unknown flag', () => {
    expect(() => parseCliOptions(['--nope'], { DATABASE_URL })).toThrow();
  });
});
