import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SuperadminSeedService } from './superadmin-seed.service';

const EMAIL = 'root@example.test';
const PASSWORD = 'correct-horse-battery-staple';

describe('SuperadminSeedService', () => {
  const createUser = jest.fn();
  const query = jest.fn();
  let log: jest.SpyInstance;

  const seed = (config: Record<string, string>, enabled = true) =>
    new SuperadminSeedService(
      new ConfigService(config),
      enabled ? ({ api: { createUser } } as never) : null,
      enabled ? ({ query } as never) : null,
    ).onApplicationBootstrap();

  beforeEach(() => {
    jest.resetAllMocks();
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  it('seeds a superadmin once when none exists', async () => {
    query.mockResolvedValue({ rowCount: 0 });

    await seed({ AUTH_SUPERADMIN_EMAIL: EMAIL, AUTH_SUPERADMIN_PASSWORD: PASSWORD });

    expect(createUser).toHaveBeenCalledTimes(1);
    expect(createUser).toHaveBeenCalledWith({
      body: { email: EMAIL, password: PASSWORD, name: 'Superadmin', role: 'superadmin' },
    });
  });

  it('skips when a superadmin exists', async () => {
    query.mockResolvedValue({ rowCount: 1 });

    await seed({ AUTH_SUPERADMIN_EMAIL: EMAIL, AUTH_SUPERADMIN_PASSWORD: PASSWORD });

    expect(createUser).not.toHaveBeenCalled();
  });

  it.each([{}, { AUTH_SUPERADMIN_EMAIL: EMAIL }])(
    'skips when the pair is unset: %j',
    async (cfg) => {
      await seed(cfg);

      expect(query).not.toHaveBeenCalled();
      expect(createUser).not.toHaveBeenCalled();
    },
  );

  it('skips when auth is disabled', async () => {
    await seed({ AUTH_SUPERADMIN_EMAIL: EMAIL, AUTH_SUPERADMIN_PASSWORD: PASSWORD }, false);

    expect(createUser).not.toHaveBeenCalled();
  });

  it('counts only non-banned superadmins', async () => {
    query.mockResolvedValue({ rowCount: 0 });

    await seed({ AUTH_SUPERADMIN_EMAIL: EMAIL, AUTH_SUPERADMIN_PASSWORD: PASSWORD });

    expect(query.mock.calls[0][0]).toContain('"banned" IS NOT TRUE');
  });

  it('skips without promoting when the seed email already exists', async () => {
    query.mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rowCount: 1 });

    await expect(
      seed({ AUTH_SUPERADMIN_EMAIL: EMAIL, AUTH_SUPERADMIN_PASSWORD: PASSWORD }),
    ).resolves.toBeUndefined();

    expect(createUser).not.toHaveBeenCalled();
  });

  it('tolerates a unique-violation race between replicas', async () => {
    query
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: 1 });
    createUser.mockRejectedValue(new Error('USER_ALREADY_EXISTS'));

    await expect(
      seed({ AUTH_SUPERADMIN_EMAIL: EMAIL, AUTH_SUPERADMIN_PASSWORD: PASSWORD }),
    ).resolves.toBeUndefined();
  });

  it('rethrows a createUser failure that is not a race', async () => {
    query.mockResolvedValue({ rowCount: 0 });
    createUser.mockRejectedValue(new Error('boom'));

    await expect(
      seed({ AUTH_SUPERADMIN_EMAIL: EMAIL, AUTH_SUPERADMIN_PASSWORD: PASSWORD }),
    ).rejects.toThrow('boom');
  });

  it('skips in worker-only mode', async () => {
    await seed({
      AUTH_SUPERADMIN_EMAIL: EMAIL,
      AUTH_SUPERADMIN_PASSWORD: PASSWORD,
      MODE: 'worker-only',
    });

    expect(query).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });

  it('logs the email and never the password', async () => {
    query.mockResolvedValue({ rowCount: 0 });

    await seed({ AUTH_SUPERADMIN_EMAIL: EMAIL, AUTH_SUPERADMIN_PASSWORD: PASSWORD });

    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain(EMAIL);
    expect(logged).not.toContain(PASSWORD);
  });
});
