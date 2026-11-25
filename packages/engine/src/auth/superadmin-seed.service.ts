import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Pool } from 'pg';
import { AppMode } from '../config/app.config';
import { SUPERADMIN_ROLE } from './domain/admin-permissions';
import { BETTER_AUTH, BETTER_AUTH_POOL } from './better-auth/better-auth.tokens';
import type { BetterAuthInstance } from './better-auth/load-better-auth';

const SUPERADMIN_DISPLAY_NAME = 'Superadmin';

/** The admin plugin's server-side `createUser`, which the base instance type does not carry. */
type CreateUserApi = {
  createUser(input: {
    body: { email: string; password: string; name: string; role: string };
  }): Promise<unknown>;
};

/** Creates the first superadmin from `AUTH_SUPERADMIN_EMAIL` / `AUTH_SUPERADMIN_PASSWORD`. */
@Injectable()
export class SuperadminSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SuperadminSeedService.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(BETTER_AUTH) private readonly auth: BetterAuthInstance | null,
    @Inject(BETTER_AUTH_POOL) private readonly pool: Pool | null,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = this.configService.get<string>('AUTH_SUPERADMIN_EMAIL');
    const password = this.configService.get<string>('AUTH_SUPERADMIN_PASSWORD');

    // A worker-only process runs no migrations (app.module.ts), so the auth schema may not exist yet.
    if (
      this.configService.get<AppMode>('MODE') === AppMode.WORKER_ONLY ||
      !this.auth ||
      !this.pool ||
      !email ||
      !password
    ) {
      return;
    }

    // Banned superadmins do not count, the same as the last-superadmin guard.
    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM "user" WHERE "banned" IS NOT TRUE AND $1 = ANY(string_to_array("role", ',')) LIMIT 1`,
      [SUPERADMIN_ROLE],
    );

    if (rowCount > 0) {
      return;
    }

    if (await this.emailExists(this.pool, email)) {
      this.logger.warn(`Superadmin seed skipped: ${email} already exists and is not a superadmin`);

      return;
    }

    try {
      // No request, so the invite-only hook treats this as a server-side creation.
      await (this.auth.api as unknown as CreateUserApi).createUser({
        body: { email, password, name: SUPERADMIN_DISPLAY_NAME, role: SUPERADMIN_ROLE },
      });
    } catch (error) {
      // Another replica seeding at the same moment wins the unique email; anything else is real.
      if (!(await this.emailExists(this.pool, email))) {
        throw error;
      }

      this.logger.warn(`Superadmin seed skipped: ${email} was created concurrently`);

      return;
    }

    this.logger.log(`Seeded superadmin ${email}`);
  }

  private async emailExists(pool: Pool, email: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      'SELECT 1 FROM "user" WHERE lower("email") = lower($1) LIMIT 1',
      [email],
    );

    return rowCount > 0;
  }
}
