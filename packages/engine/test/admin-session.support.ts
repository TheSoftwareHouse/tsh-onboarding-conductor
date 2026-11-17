import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import request from 'supertest';
import { BETTER_AUTH, BETTER_AUTH_POOL } from '../src/auth/better-auth/better-auth.tokens';
import type { BetterAuthInstance } from '../src/auth/better-auth/load-better-auth';

/** Every user and organization this helper creates carries these, so one query can sweep them. */
export const OPERATOR_EMAIL_DOMAIN = 'e2e-operator.test';
const ORGANIZATION_SLUG_PREFIX = 'e2e-operator-';

export const OPERATOR_PASSWORD = 'e2e-Operator-pass-123';

export interface OperatorOptions {
  /** Admin-plugin platform role; omit for a plain user. */
  platformRole?: 'superadmin';
  /** When set, the user is made a member of a fresh organization under this role. */
  organizationRole?: 'owner' | 'admin' | 'member';
  /** Marks TOTP as enrolled. Applied after sign-in: setting it earlier turns sign-in into a challenge. */
  twoFactor?: boolean;
}

export interface Operator {
  /** Value for a `Cookie` request header. */
  cookie: string;
  userId: string;
  email: string;
  organizationId: string | null;
}

/** The plugin endpoints are not in the base instance type; these are the server-side calls used. */
type ServerApi = {
  createUser(input: {
    body: { email: string; password: string; name: string; role: string };
  }): Promise<{ user: { id: string } }>;
  createOrganization(input: {
    body: { name: string; slug: string; userId: string };
  }): Promise<{ id: string }>;
};

const authOf = (app: INestApplication) => app.get<BetterAuthInstance>(BETTER_AUTH);
const poolOf = (app: INestApplication) => app.get<Pool>(BETTER_AUTH_POOL);

/**
 * Creates an operator through the auth instance and signs them in over HTTP.
 *
 * Order matters and is fixed here: create the user and organization, sign in, and only then set
 * `twoFactorEnabled`. Setting the flag first would turn the sign-in into a TOTP challenge that
 * returns no session cookie. The user is created server-side because HTTP sign-up is invite-only.
 */
export async function createOperator(
  app: INestApplication,
  options: OperatorOptions = {},
): Promise<Operator> {
  const api = authOf(app).api as unknown as ServerApi;
  const pool = poolOf(app);
  const email = `${randomUUID()}@${OPERATOR_EMAIL_DOMAIN}`;

  const { user } = await api.createUser({
    body: {
      email,
      password: OPERATOR_PASSWORD,
      name: 'E2E Operator',
      role: options.platformRole ?? 'user',
    },
  });

  let organizationId: string | null = null;

  if (options.organizationRole) {
    // The creator becomes `owner`; any other role is a straight update of that member row.
    const organization = await api.createOrganization({
      body: {
        name: 'E2E Organization',
        slug: `${ORGANIZATION_SLUG_PREFIX}${randomUUID()}`,
        userId: user.id,
      },
    });
    organizationId = organization.id;

    if (options.organizationRole !== 'owner') {
      await pool.query('UPDATE auth."member" SET "role" = $1 WHERE "userId" = $2', [
        options.organizationRole,
        user.id,
      ]);
    }
  }

  const cookie = await signIn(app, email, OPERATOR_PASSWORD);

  if (options.twoFactor) {
    await pool.query('UPDATE auth."user" SET "twoFactorEnabled" = true WHERE "id" = $1', [user.id]);
  }

  return { cookie, userId: user.id, email, organizationId };
}

/** Signs in over HTTP and returns the session as a `Cookie` header value. */
export async function signIn(
  app: INestApplication,
  email: string,
  password: string,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/v1/auth/sign-in/email')
    .send({ email, password })
    .expect(200);

  const setCookie = response.headers['set-cookie'] as unknown as string[] | undefined;

  if (!setCookie?.length) {
    throw new Error(`Sign-in for ${email} returned no session cookie`);
  }

  return setCookie.map((cookie) => cookie.split(';')[0]).join('; ');
}

/** Removes every operator and organization `createOperator` made; sessions and members cascade. */
export async function deleteOperators(app: INestApplication): Promise<void> {
  const pool = poolOf(app);

  await pool.query('DELETE FROM auth."organization" WHERE "slug" LIKE $1', [
    `${ORGANIZATION_SLUG_PREFIX}%`,
  ]);
  await pool.query('DELETE FROM auth."user" WHERE "email" LIKE $1', [`%@${OPERATOR_EMAIL_DOMAIN}`]);
}
