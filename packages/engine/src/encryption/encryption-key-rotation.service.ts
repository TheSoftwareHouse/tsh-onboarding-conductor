import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig, AppMode } from '../config/app.config';
import { EncryptionAdminService } from './encryption-admin.service';
import { EncryptionKeyRingService } from './encryption-key-ring.service';

/**
 * Rotates the encryption key on the schedule the active key carries (`rotation_interval`,
 * migration `0026`), so a deployment keeps getting fresh keys without an operator pressing
 * anything. Deliberately thin: it owns the timer and nothing else — every decision (is there a
 * key, does it carry a schedule, has that schedule come due, and the write itself) belongs to
 * `EncryptionAdminService.rotateIfDue`, which is where every other change to `encryption_keys`
 * already lives.
 *
 * Same poller shape as `EncryptionSweepService`, for the same reasons: skipped in
 * `MODE=api-only` and on a process holding no key-encryption key, started from
 * `onApplicationBootstrap` rather than `onModuleInit` so the ring's boot-time reload has already
 * run, one immediate check then `setInterval`, every tick wrapped so a failure is logged and the
 * timer survives it, and `onModuleDestroy` clearing the timer and awaiting the in-flight check.
 * The immediate check matters on its own: a key that came due while every process was down is
 * rotated at boot rather than one interval later.
 *
 * Every replica running this polls the same table, and a due key would be seen by all of them at
 * once. They do not need to coordinate here because `rotateIfDue` takes an advisory lock for the
 * whole of its read-and-replace, so the second replica reads the key the first just created and
 * finds it not due.
 */
@Injectable()
export class EncryptionKeyRotationService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EncryptionKeyRotationService.name);
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isShuttingDown = false;
  private activeCheckPromise: Promise<void> | null = null;

  constructor(
    private readonly encryptionAdminService: EncryptionAdminService,
    private readonly keyRing: EncryptionKeyRingService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  onApplicationBootstrap(): void {
    // Without the key-encryption key this process cannot wrap a new data key, so it could never
    // complete a rotation; the ring already refused to boot if the table had keys.
    if (!this.keyRing.isKeyEncryptionKeyConfigured()) {
      return;
    }

    if (this.configService.getOrThrow<AppMode>('MODE') === AppMode.API_ONLY) {
      return;
    }

    const checkIntervalMs = this.configService.getOrThrow<number>(
      'ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_MS',
    );

    void this.runCheck();
    this.timer = setInterval(() => void this.runCheck(), checkIntervalMs);
  }

  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    await this.activeCheckPromise;
  }

  /**
   * One tick: rotate if the schedule has come due, and say so. A tick that fails — the database
   * unreachable, a peer holding the lock past a statement timeout — is logged with a stable code
   * and left for the next one; the schedule is stored, so nothing about a missed tick is lost.
   */
  private async runCheck(): Promise<void> {
    if (this.isRunning || this.isShuttingDown) {
      return;
    }

    this.isRunning = true;
    const activeCheckPromise = this.rotateIfDue();
    this.activeCheckPromise = activeCheckPromise;

    await activeCheckPromise;

    if (this.activeCheckPromise === activeCheckPromise) {
      this.activeCheckPromise = null;
    }
  }

  private async rotateIfDue(): Promise<void> {
    try {
      const rotated = await this.encryptionAdminService.rotateIfDue();

      if (rotated !== null) {
        this.logger.log(`ENCRYPTION_KEY_ROTATED_ON_SCHEDULE keyId=${rotated.id}`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`ENCRYPTION_KEY_ROTATION_FAILED reason=${reason}`);
    } finally {
      this.isRunning = false;
    }
  }
}
