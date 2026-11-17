import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * better-auth's tables (emailAndPassword, twoFactor, organization, admin plugins) in their own
 * `auth` schema, with the library's camelCase column names untouched. Ported from the SQL
 * `auth@1.7.25 generate` emits for that plugin set; foreign keys are standalone constraints, as
 * everywhere else. No entities map these tables: better-auth owns them, the engine never does.
 */
export class BetterAuthSchema0003 implements MigrationInterface {
  name = '0003_better_auth_schema_2056060800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA auth');

    await queryRunner.query(`
      CREATE TABLE auth."user" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "email" TEXT NOT NULL UNIQUE,
        "emailVerified" BOOLEAN NOT NULL,
        "image" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "twoFactorEnabled" BOOLEAN,
        "role" TEXT,
        "banned" BOOLEAN,
        "banReason" TEXT,
        "banExpires" TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`
      CREATE TABLE auth."session" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "expiresAt" TIMESTAMPTZ NOT NULL,
        "token" TEXT NOT NULL UNIQUE,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ NOT NULL,
        "ipAddress" TEXT,
        "userAgent" TEXT,
        "userId" TEXT NOT NULL,
        "activeOrganizationId" TEXT,
        "impersonatedBy" TEXT
      )
    `);
    await queryRunner.query(`
      CREATE TABLE auth."account" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "accountId" TEXT NOT NULL,
        "providerId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "accessToken" TEXT,
        "refreshToken" TEXT,
        "idToken" TEXT,
        "accessTokenExpiresAt" TIMESTAMPTZ,
        "refreshTokenExpiresAt" TIMESTAMPTZ,
        "scope" TEXT,
        "password" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ NOT NULL
      )
    `);
    await queryRunner.query(`
      CREATE TABLE auth."verification" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "identifier" TEXT NOT NULL,
        "value" TEXT NOT NULL,
        "expiresAt" TIMESTAMPTZ NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query(`
      CREATE TABLE auth."twoFactor" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "secret" TEXT NOT NULL,
        "backupCodes" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "verified" BOOLEAN,
        "failedVerificationCount" INTEGER,
        "lockedUntil" TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`
      CREATE TABLE auth."organization" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "slug" TEXT NOT NULL UNIQUE,
        "logo" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL,
        "metadata" TEXT
      )
    `);
    await queryRunner.query(`
      CREATE TABLE auth."member" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "role" TEXT NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL
      )
    `);
    await queryRunner.query(`
      CREATE TABLE auth."invitation" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "role" TEXT,
        "status" TEXT NOT NULL,
        "expiresAt" TIMESTAMPTZ NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "inviterId" TEXT NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "session_userId_idx" ON auth."session" ("userId");
      CREATE INDEX "account_userId_idx" ON auth."account" ("userId");
      CREATE INDEX "verification_identifier_idx" ON auth."verification" ("identifier");
      CREATE INDEX "twoFactor_secret_idx" ON auth."twoFactor" ("secret");
      CREATE INDEX "twoFactor_userId_idx" ON auth."twoFactor" ("userId");
      CREATE INDEX "member_organizationId_idx" ON auth."member" ("organizationId");
      CREATE INDEX "member_userId_idx" ON auth."member" ("userId");
      CREATE INDEX "invitation_organizationId_idx" ON auth."invitation" ("organizationId");
      CREATE INDEX "invitation_email_idx" ON auth."invitation" ("email")
    `);

    await queryRunner.query(`
      ALTER TABLE auth."session"
        ADD CONSTRAINT fk_auth_session_user
        FOREIGN KEY ("userId") REFERENCES auth."user" ("id") ON DELETE CASCADE;
      ALTER TABLE auth."account"
        ADD CONSTRAINT fk_auth_account_user
        FOREIGN KEY ("userId") REFERENCES auth."user" ("id") ON DELETE CASCADE;
      ALTER TABLE auth."twoFactor"
        ADD CONSTRAINT fk_auth_two_factor_user
        FOREIGN KEY ("userId") REFERENCES auth."user" ("id") ON DELETE CASCADE;
      ALTER TABLE auth."member"
        ADD CONSTRAINT fk_auth_member_organization
        FOREIGN KEY ("organizationId") REFERENCES auth."organization" ("id") ON DELETE CASCADE;
      ALTER TABLE auth."member"
        ADD CONSTRAINT fk_auth_member_user
        FOREIGN KEY ("userId") REFERENCES auth."user" ("id") ON DELETE CASCADE;
      ALTER TABLE auth."invitation"
        ADD CONSTRAINT fk_auth_invitation_organization
        FOREIGN KEY ("organizationId") REFERENCES auth."organization" ("id") ON DELETE CASCADE;
      ALTER TABLE auth."invitation"
        ADD CONSTRAINT fk_auth_invitation_inviter
        FOREIGN KEY ("inviterId") REFERENCES auth."user" ("id") ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP SCHEMA IF EXISTS auth CASCADE');
  }
}
