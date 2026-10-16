import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { AppConfig } from '../config/app.config';

/**
 * The OTP challenges' own connection pool, apart from the application's.
 *
 * An OTP connector runs inside the onboarding submit's transaction, which already holds one of the
 * main pool's connections, and it must write its challenge outside that transaction (see
 * `BaseOtpConnector`). Taking that second connection from the main pool is hold-and-wait on one
 * pool: with `pg`'s defaults (`max: 10`, `connectionTimeoutMillis: 0`) enough concurrent OTP
 * submits each hold a connection while waiting forever for another, and the engine stops. A
 * connection of this pool is held only for the length of one query and never while waiting on the
 * main pool, so a submit can only queue here, never close a cycle.
 *
 * The pool opens on first use, so a process that never runs an OTP step never connects. It has no
 * entity metadata: `OtpChallengesRepository` speaks plain SQL.
 */
@Injectable()
export class OtpChallengesConnection implements OnApplicationShutdown {
  private dataSource: Promise<DataSource> | undefined;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  async getManager(): Promise<EntityManager> {
    this.dataSource ??= this.open();
    return (await this.dataSource).manager;
  }

  async onApplicationShutdown(): Promise<void> {
    const dataSource = this.dataSource;
    this.dataSource = undefined;
    const opened = await dataSource?.catch(() => undefined);
    if (opened?.isInitialized) {
      await opened.destroy();
    }
  }

  /** A failed open is forgotten, so the next OTP step tries again instead of failing for good. */
  private open(): Promise<DataSource> {
    return new DataSource({
      type: 'postgres',
      url: this.configService.getOrThrow<string>('DATABASE_URL'),
      poolSize: this.configService.getOrThrow<number>('OTP_DATABASE_POOL_SIZE'),
      entities: [],
      synchronize: false,
      migrationsRun: false,
    })
      .initialize()
      .catch((error: unknown) => {
        this.dataSource = undefined;
        throw error;
      });
  }
}
