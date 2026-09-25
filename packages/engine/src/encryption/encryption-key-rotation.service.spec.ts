import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { AppConfig, AppMode } from '../config/app.config';
import { EncryptionAdminService } from './encryption-admin.service';
import { EncryptionKeyRingService } from './encryption-key-ring.service';
import { EncryptionKeyRotationService } from './encryption-key-rotation.service';

const CHECK_INTERVAL_MS = 60000;

describe('EncryptionKeyRotationService', () => {
  /** Lets the immediate check and anything it awaited settle under fake timers. */
  const settle = async () => {
    for (let index = 0; index < 50; index += 1) {
      await Promise.resolve();
    }
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const createHarness = (
    options: { mode?: AppMode; keyConfigured?: boolean; checkIntervalMs?: number } = {},
  ) => {
    const encryptionAdminService = {
      rotateIfDue: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<Pick<EncryptionAdminService, 'rotateIfDue'>>;

    const keyRing = {
      isKeyEncryptionKeyConfigured: jest.fn().mockReturnValue(options.keyConfigured ?? true),
    } as unknown as EncryptionKeyRingService;

    const configService = {
      getOrThrow: jest.fn().mockImplementation((key: keyof AppConfig) => {
        switch (key) {
          case 'MODE':
            return options.mode ?? AppMode.WORKER_ONLY;
          case 'ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_MS':
            return options.checkIntervalMs ?? CHECK_INTERVAL_MS;
          default:
            throw new Error(`Unexpected config key: ${String(key)}`);
        }
      }),
    } as unknown as ConfigService<AppConfig, true>;

    const service = new EncryptionKeyRotationService(
      encryptionAdminService as unknown as EncryptionAdminService,
      keyRing,
      configService,
    );

    return { service, encryptionAdminService, keyRing, configService };
  };

  it('checks immediately at bootstrap, so a key that came due while the engine was down rotates at once', async () => {
    const { service, encryptionAdminService } = createHarness();

    service.onApplicationBootstrap();
    await settle();

    expect(encryptionAdminService.rotateIfDue).toHaveBeenCalledTimes(1);

    await service.onModuleDestroy();
  });

  it('keeps checking on the configured interval', async () => {
    const { service, encryptionAdminService } = createHarness();

    service.onApplicationBootstrap();
    await settle();
    jest.advanceTimersByTime(CHECK_INTERVAL_MS);
    await settle();
    jest.advanceTimersByTime(CHECK_INTERVAL_MS);
    await settle();

    expect(encryptionAdminService.rotateIfDue).toHaveBeenCalledTimes(3);

    await service.onModuleDestroy();
  });

  it('never starts in api-only mode: rotation belongs with the background work', async () => {
    const { service, encryptionAdminService } = createHarness({ mode: AppMode.API_ONLY });

    service.onApplicationBootstrap();
    jest.advanceTimersByTime(CHECK_INTERVAL_MS * 5);
    await settle();

    expect(encryptionAdminService.rotateIfDue).not.toHaveBeenCalled();
  });

  it('never starts on a process holding no key-encryption key: it could not wrap a new key', async () => {
    const { service, encryptionAdminService } = createHarness({ keyConfigured: false });

    service.onApplicationBootstrap();
    jest.advanceTimersByTime(CHECK_INTERVAL_MS * 5);
    await settle();

    expect(encryptionAdminService.rotateIfDue).not.toHaveBeenCalled();
  });

  it('logs a rotation it made, naming only the key id', async () => {
    const { service, encryptionAdminService } = createHarness();
    encryptionAdminService.rotateIfDue.mockResolvedValue({ id: 'key-new' });
    const log = jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);

    service.onApplicationBootstrap();
    await settle();

    expect(log).toHaveBeenCalledWith('ENCRYPTION_KEY_ROTATED_ON_SCHEDULE keyId=key-new');

    await service.onModuleDestroy();
  });

  it('logs a failed check and keeps the timer alive for the next one', async () => {
    const { service, encryptionAdminService } = createHarness();
    encryptionAdminService.rotateIfDue.mockRejectedValueOnce(new Error('connection reset'));
    const error = jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

    service.onApplicationBootstrap();
    await settle();
    jest.advanceTimersByTime(CHECK_INTERVAL_MS);
    await settle();

    expect(error).toHaveBeenCalledWith('ENCRYPTION_KEY_ROTATION_FAILED reason=connection reset');
    expect(encryptionAdminService.rotateIfDue).toHaveBeenCalledTimes(2);

    await service.onModuleDestroy();
  });

  it('never runs two checks at once, however long one takes', async () => {
    const { service, encryptionAdminService } = createHarness();
    let release = (): void => undefined;
    encryptionAdminService.rotateIfDue.mockImplementation(
      async () => new Promise((resolve) => (release = () => resolve(null))),
    );

    service.onApplicationBootstrap();
    await settle();
    jest.advanceTimersByTime(CHECK_INTERVAL_MS * 3);
    await settle();

    expect(encryptionAdminService.rotateIfDue).toHaveBeenCalledTimes(1);

    release();
    await settle();
    await service.onModuleDestroy();
  });

  it('stops checking on shutdown and waits for the check in flight', async () => {
    const { service, encryptionAdminService } = createHarness();

    service.onApplicationBootstrap();
    await settle();
    await service.onModuleDestroy();

    jest.advanceTimersByTime(CHECK_INTERVAL_MS * 5);
    await settle();

    expect(encryptionAdminService.rotateIfDue).toHaveBeenCalledTimes(1);
  });
});
