import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Pool } from 'pg';
import { DataSource } from 'typeorm';
import { AppMode } from '../config/app.config';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { ORGANIZATION_OWNER_ROLE, SUPERADMIN_ROLE } from './domain/admin-permissions';
import { BETTER_AUTH, BETTER_AUTH_POOL } from './better-auth/better-auth.tokens';
import type { BetterAuthInstance } from './better-auth/load-better-auth';

const SUPERADMIN_DISPLAY_NAME = 'Superadmin';

/** Arbitrary key of the Postgres advisory lock that serializes the owner seed across replicas. */
const OWNER_SEED_LOCK_KEY = 5530100101;

/** better-auth's `APIError`, recognised by shape because the library is never imported here. */
interface AuthApiError extends Error {
  body?: { code?: string };
}

function isAuthApiError(error: unknown): error is AuthApiError {
  return error instanceof Error && error.name === 'APIError';
}

/** The admin plugin's server-side `createUser`, which the base instance type does not carry. */
type CreateUserApi = {
  createUser(input: {
    body: { email: string; password: string; name: string; role: string };
  }): Promise<unknown>;
};

/** The organization plugin's server-side `addMember`: with a `userId` and no session it is a system action. */
type AddMemberApi = {
  addMember(input: {
    body: { userId: string; organizationId: string; role: string };
  }): Promise<unknown>;
};

/**
 * Creates the first superadmin from `AUTH_SUPERADMIN_EMAIL` / `AUTH_SUPERADMIN_PASSWORD` and makes
 * that superadmin an owner of the default organization: better-auth lets only a member invite, and
 * migration 0004 creates the organization with no members.
 */
@Injectable()
export class SuperadminSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SuperadminSeedService.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(BETTER_AUTH) private readonly auth: BetterAuthInstance | null,
    @Inject(BETTER_AUTH_POOL) private readonly pool: Pool | null,
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly dataSource: DataSource,
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

    await this.seedSuperadmin(this.auth, this.pool, email, password);
    await this.ensureOwnerOfDefaultOrganization(this.auth, this.pool, email);
  }

  private async seedSuperadmin(
    auth: BetterAuthInstance,
    pool: Pool,
    email: string,
    password: string,
  ): Promise<void> {
    // Banned superadmins do not count, the same as the last-superadmin guard.
    const { rowCount } = await pool.query(
      `SELECT 1 FROM "user" WHERE "banned" IS NOT TRUE AND $1 = ANY(string_to_array("role", ',')) LIMIT 1`,
      [SUPERADMIN_ROLE],
    );

    if (rowCount > 0) {
      return;
    }

    if (await this.emailExists(pool, email)) {
      this.logger.warn(`Superadmin seed skipped: ${email} already exists and is not a superadmin`);

      return;
    }

    try {
      // No request, so the invite-only hook treats this as a server-side creation.
      await (auth.api as unknown as CreateUserApi).createUser({
        body: { email, password, name: SUPERADMIN_DISPLAY_NAME, role: SUPERADMIN_ROLE },
      });
    } catch (error) {
      // Another replica seeding at the same moment wins the unique email; anything else is real.
      if (!(await this.emailExists(pool, email))) {
        throw error;
      }

      this.logger.warn(`Superadmin seed skipped: ${email} was created concurrently`);

      return;
    }

    this.logger.log(`Seeded superadmin ${email}`);
  }

  /**
   * Runs on every boot, so an upgraded install whose superadmin already exists gets the membership
   * too. The default organization comes from the repository, which reads through TypeORM; the
   * member row is written by better-auth on the auth pool.
   */
  private async ensureOwnerOfDefaultOrganization(
    auth: BetterAuthInstance,
    pool: Pool,
    email: string,
  ): Promise<void> {
    const { rows } = await pool.query(
      `SELECT "id" FROM "user" WHERE lower("email") = lower($1) AND "banned" IS NOT TRUE AND $2 = ANY(string_to_array("role", ',')) LIMIT 1`,
      [email, SUPERADMIN_ROLE],
    );
    const userId = rows[0]?.id as string | undefined;

    if (!userId) {
      return;
    }

    const organizationId = await this.organizationsRepository.getDefaultId(this.dataSource.manager);

    // `auth."member"` has no unique (organizationId, userId) and addMember checks then inserts, so
    // replicas booting together are serialized by a session lock held on a dedicated connection for
    // the whole check and insert; addMember runs on the pool's other connections.
    const client = await pool.connect();

    try {
      await client.query('SELECT pg_advisory_lock($1)', [OWNER_SEED_LOCK_KEY]);

      try {
        if (await this.isMember(client, userId, organizationId)) {
          return;
        }

        await (auth.api as unknown as AddMemberApi).addMember({
          body: { userId, organizationId, role: ORGANIZATION_OWNER_ROLE },
        });
      } catch (error) {
        // A refusal such as the membership limit repeats on every start; a database fault must not.
        if (!isAuthApiError(error)) {
          throw error;
        }

        this.logger.warn(
          `Could not make ${email} owner of the default organization: ${error.body?.code ?? error.message}`,
        );

        return;
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [OWNER_SEED_LOCK_KEY]);
      }
    } finally {
      client.release();
    }

    this.logger.log(`Made ${email} owner of the default organization`);
  }

  private async isMember(
    db: Pick<Pool, 'query'>,
    userId: string,
    organizationId: string,
  ): Promise<boolean> {
    const { rowCount } = await db.query(
      'SELECT 1 FROM "member" WHERE "userId" = $1 AND "organizationId" = $2 LIMIT 1',
      [userId, organizationId],
    );

    return rowCount > 0;
  }

  private async emailExists(pool: Pool, email: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      'SELECT 1 FROM "user" WHERE lower("email") = lower($1) LIMIT 1',
      [email],
    );

    return rowCount > 0;
  }
}
