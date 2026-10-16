import { ConfigService } from '@nestjs/config';
import { DataSource, type DataSourceOptions } from 'typeorm';
import type { AppConfig } from '../config/app.config';
import { OtpChallengesConnection } from './otp-challenges.connection';

const DATABASE_URL = 'postgres://user:pass@localhost:5432/db';
const POOL_SIZE = 3;

describe('OtpChallengesConnection', () => {
  const configService = {
    getOrThrow: jest.fn((key: string) =>
      key === 'DATABASE_URL' ? DATABASE_URL : key === 'OTP_DATABASE_POOL_SIZE' ? POOL_SIZE : '',
    ),
  } as unknown as ConfigService<AppConfig, true>;

  const stubInitialize = () =>
    jest.spyOn(DataSource.prototype, 'initialize').mockImplementation(function (this: DataSource) {
      Object.assign(this, { isInitialized: true });
      return Promise.resolve(this);
    });

  it('opens nothing until the first OTP step asks for a manager', () => {
    const initialize = stubInitialize();

    new OtpChallengesConnection(configService);

    expect(initialize).not.toHaveBeenCalled();
  });

  it('opens one pool of its own, sized by OTP_DATABASE_POOL_SIZE, and reuses it', async () => {
    const initialize = stubInitialize();
    const sut = new OtpChallengesConnection(configService);

    const first = await sut.getManager();
    const second = await sut.getManager();

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    const options = first.connection.options as DataSourceOptions & {
      url: string;
      poolSize: number;
    };
    expect(options).toMatchObject({
      type: 'postgres',
      url: DATABASE_URL,
      poolSize: POOL_SIZE,
      entities: [],
      migrationsRun: false,
      synchronize: false,
    });
  });

  it('forgets a failed open, so the next OTP step tries again', async () => {
    const initialize = stubInitialize();
    initialize.mockRejectedValueOnce(new Error('connection refused'));
    const sut = new OtpChallengesConnection(configService);

    await expect(sut.getManager()).rejects.toThrow('connection refused');
    await expect(sut.getManager()).resolves.toBeDefined();
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it('closes the pool on shutdown, and does nothing when it never opened', async () => {
    stubInitialize();
    const destroy = jest.spyOn(DataSource.prototype, 'destroy').mockResolvedValue(undefined);
    const idle = new OtpChallengesConnection(configService);
    const used = new OtpChallengesConnection(configService);
    await used.getManager();

    await idle.onApplicationShutdown();
    await used.onApplicationShutdown();

    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
