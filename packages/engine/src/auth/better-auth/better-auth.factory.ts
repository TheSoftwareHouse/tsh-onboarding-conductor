import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import {
  ADMIN_PERMISSION_STATEMENTS,
  ORGANIZATION_ROLE_PERMISSIONS,
  SUPERADMIN_PERMISSIONS,
  SUPERADMIN_ROLE,
} from '../domain/admin-permissions';
import type { AuthMailer } from '../auth-mailer';
import { findActiveOrganizationId } from './active-organization.hook';
import { buildInvitationLink } from './invitation-link';
import { EndpointGuardRefusal, findEndpointGuardRefusal } from './auth-endpoint-guards.hook';
import {
  INVITE_ONLY_REFUSAL_MESSAGE,
  UserCreationVerdict,
  judgeUserCreation,
} from './invite-only.hook';
import {
  loadBetterAuth,
  type BetterAuthInstance,
  type BetterAuthRuntime,
} from './load-better-auth';

type AuthPlugins = Parameters<BetterAuthRuntime['betterAuth']>[0]['plugins'];

export const AUTH_BASE_PATH = '/v1/auth';

const logger = new Logger('BetterAuth');

/** better-auth's tables live in their own Postgres schema, created by migration 0003. */
const AUTH_SCHEMA_SEARCH_PATH = '-c search_path=auth';

export function createAuthPool(configService: ConfigService): Pool {
  return new Pool({
    connectionString: configService.getOrThrow<string>('DATABASE_URL'),
    options: AUTH_SCHEMA_SEARCH_PATH,
  });
}

const SUPERADMIN_ROLE_MATCH = `$1 = ANY(string_to_array("role", ','))`;

/** The reads the invite-only, active-organization and endpoint-guard rules make against the auth schema. */
function createStoreLookups(pool: Pool) {
  return {
    async findInvitations(email: string) {
      const { rows } = await pool.query(
        'SELECT "id", "status", "expiresAt" FROM "invitation" WHERE lower("email") = lower($1)',
        [email],
      );

      return rows.map((row) => ({
        id: row.id as string,
        status: row.status as string,
        expiresAt: row.expiresAt as Date,
      }));
    },
    async findFirstOrganizationId(userId: string) {
      const { rows } = await pool.query(
        'SELECT "organizationId" FROM "member" WHERE "userId" = $1 ORDER BY "createdAt" ASC LIMIT 1',
        [userId],
      );

      return (rows[0]?.organizationId as string | undefined) ?? null;
    },
    async findUser(userId: string) {
      const { rows } = await pool.query('SELECT "role", "banned" FROM "user" WHERE "id" = $1', [
        userId,
      ]);

      return rows[0]
        ? { role: rows[0].role as string | null, banned: rows[0].banned === true }
        : null;
    },
    async countActiveSuperadminsExcept(userId: string) {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS "count" FROM "user" WHERE "id" <> $2 AND "banned" IS NOT TRUE AND ${SUPERADMIN_ROLE_MATCH}`,
        [SUPERADMIN_ROLE, userId],
      );

      return rows[0].count as number;
    },
  };
}

const ENDPOINT_GUARD_MESSAGES: Record<EndpointGuardRefusal, string> = {
  [EndpointGuardRefusal.LAST_SUPERADMIN]: 'At least one active superadmin must remain.',
};

export async function createBetterAuth(
  configService: ConfigService,
  pool: Pool,
  mailer: AuthMailer,
): Promise<BetterAuthInstance> {
  const { betterAuth, api, plugins, access, organizationAccess } = await loadBetterAuth();
  const store = createStoreLookups(pool);

  const baseURL = configService.getOrThrow<string>('BETTER_AUTH_URL');
  const microsoftClientId = configService.get<string>('AUTH_MICROSOFT_CLIENT_ID');

  const organizationAc = access.createAccessControl({
    ...organizationAccess.defaultStatements,
    ...ADMIN_PERMISSION_STATEMENTS,
  });
  // Owner and admin keep the library's member / invitation management and add the engine grants.
  const organizationRoles = {
    owner: organizationAc.newRole({
      ...organizationAccess.ownerAc.statements,
      ...ORGANIZATION_ROLE_PERMISSIONS.owner,
    }),
    admin: organizationAc.newRole({
      ...organizationAccess.adminAc.statements,
      ...ORGANIZATION_ROLE_PERMISSIONS.admin,
    }),
    member: organizationAc.newRole({
      ...organizationAccess.memberAc.statements,
      ...ORGANIZATION_ROLE_PERMISSIONS.member,
    }),
  };

  const platformAc = access.createAccessControl(SUPERADMIN_PERMISSIONS);

  return betterAuth({
    basePath: AUTH_BASE_PATH,
    baseURL,
    secret: configService.getOrThrow<string>('BETTER_AUTH_SECRET'),
    trustedOrigins: [configService.getOrThrow<string>('ADMIN_PANEL_ORIGIN')],
    database: pool,
    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: configService.get<string>('NODE_ENV') === 'production',
      },
      // Migration 0003 owns the schema; better-auth must never diff or touch it at runtime.
      database: { validateSchema: false },
    },
    emailAndPassword: {
      enabled: true,
      revokeSessionsOnPasswordReset: true,
      // Not awaited: a send that takes longer for a known address would reveal which exist. A
      // failure is still logged, or a broken AUTH_SMTP_URL shows only as resets that never arrive.
      sendResetPassword: async ({ user, url }) => {
        void mailer.sendPasswordReset(user.email, url).catch((error: unknown) => {
          logger.error(
            `AUTH_PASSWORD_RESET_MAIL_FAILED userId=${JSON.stringify(user.id)} reason=${JSON.stringify(
              error instanceof Error ? error.message : 'unknown',
            )}`,
          );
        });
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            // A `request` exists only for a call that came in over HTTP; `auth.api.*` called from
            // the engine (seed, admin createUser) has none.
            const verdict = await judgeUserCreation(
              {
                email: user.email,
                path: context?.request ? context.path : null,
                invitationId: (context?.body as { invitationId?: unknown } | undefined)
                  ?.invitationId,
              },
              store,
            );

            if (verdict === UserCreationVerdict.REFUSED) {
              throw new api.APIError('FORBIDDEN', { message: INVITE_ONLY_REFUSAL_MESSAGE });
            }

            // Naming the mailed invitation proves the address, so the account starts verified.
            return verdict === UserCreationVerdict.ALLOWED_EMAIL_PROVEN
              ? { data: { emailVerified: true } }
              : undefined;
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const activeOrganizationId = await findActiveOrganizationId(session, store);

            return activeOrganizationId ? { data: { activeOrganizationId } } : undefined;
          },
        },
      },
    },
    hooks: {
      before: api.createAuthMiddleware(async (ctx) => {
        const refusal = await findEndpointGuardRefusal(ctx.path, ctx.body, store);

        if (refusal) {
          throw new api.APIError('FORBIDDEN', {
            code: refusal,
            message: ENDPOINT_GUARD_MESSAGES[refusal],
          });
        }
      }),
    },
    ...(microsoftClientId && {
      socialProviders: {
        microsoft: {
          clientId: microsoftClientId,
          clientSecret: configService.getOrThrow<string>('AUTH_MICROSOFT_CLIENT_SECRET'),
          tenantId: configService.getOrThrow<string>('AUTH_MICROSOFT_TENANT_ID'),
        },
      },
    }),
    // Cast: the engine's relaxed `strictNullChecks` makes the organization and admin plugin types
    // structurally incompatible with `BetterAuthPlugin`; the runtime shapes are the library's own.
    plugins: [
      plugins.twoFactor({ issuer: configService.getOrThrow<string>('ENVIRONMENT_NAME') }),
      plugins.organization({
        sendInvitationEmail: ({ id, email, organization, inviter }, request) =>
          mailer.sendInvitation(
            email,
            organization.name,
            inviter.user.name,
            buildInvitationLink(id, request?.headers.get('origin'), {
              engineUrl: baseURL,
              panelOrigin: configService.getOrThrow<string>('ADMIN_PANEL_ORIGIN'),
            }),
          ),
        ac: organizationAc,
        roles: organizationRoles,
        // One organization in the MVP (ADR 0055): migration 0004 creates it, nobody adds or removes one.
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
      }),
      plugins.admin({
        ac: platformAc,
        roles: {
          [SUPERADMIN_ROLE]: platformAc.newRole(SUPERADMIN_PERMISSIONS),
          user: platformAc.newRole({ user: [], session: [] }),
        },
        adminRoles: [SUPERADMIN_ROLE],
      }),
    ] as unknown as AuthPlugins,
    // Cast: same relaxed-`strictNullChecks` mismatch as the plugins above, now also in the hooks' context types.
  }) as unknown as BetterAuthInstance;
}
