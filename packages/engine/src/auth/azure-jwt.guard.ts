import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JWTPayload } from 'jose';
import { parseAdminRequiredRoles } from '../config/app.config';
import { ADMIN_TOKEN_VERIFIER, type AdminTokenVerifierPort } from './admin-token-verifier.port';

const BEARER_PREFIX = 'bearer ';

type AuthenticatedRequest = {
  headers?: Record<string, string | string[] | undefined>;
  adminTokenClaims?: JWTPayload;
};

export function readBearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') {
    return null;
  }

  if (!header.toLowerCase().startsWith(BEARER_PREFIX)) {
    return null;
  }

  const token = header.slice(BEARER_PREFIX.length).trim();

  return token === '' ? null : token;
}

/**
 * Reads `iss`, `aud` and `ver` out of an unverified token purely for logging. These values are
 * never trusted for a decision; they exist so a rejection says which token turned up — a v1.0
 * token from `sts.windows.net`, for instance, is a configuration problem rather than an attack.
 */
export function describeUnverifiedToken(token: string): string {
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );

    if (typeof payload !== 'object' || payload === null) {
      return 'claims=unreadable';
    }

    const { iss, aud, ver } = payload as Record<string, unknown>;

    return `iss=${String(iss)} aud=${String(aud)} ver=${String(ver)}`;
  } catch {
    return 'claims=unreadable';
  }
}

/**
 * Checks the token's `roles` claim against the configured allowlist. Entra only emits the claim
 * for app roles the user is actually assigned, so an unassigned operator has no roles at all.
 * The comparison ignores case, because a role's configured spelling and its portal "Value" are
 * easy to drift apart and the failure would otherwise be a silent 403.
 */
export function hasAnyRequiredRole(claim: unknown, requiredRoles: readonly string[]): boolean {
  const grantedRoles = Array.isArray(claim)
    ? claim
        .filter((role): role is string => typeof role === 'string')
        .map((role) => role.toLowerCase())
    : [];

  return requiredRoles.some((role) => grantedRoles.includes(role.toLowerCase()));
}

/**
 * Protects the admin read endpoints with a Microsoft Entra ID access token. Any verification
 * failure is a 401, never a 500, so a rotated key or an expired token cannot be mistaken for
 * an engine outage.
 */
@Injectable()
export class AzureJwtGuard implements CanActivate {
  private readonly logger = new Logger(AzureJwtGuard.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(ADMIN_TOKEN_VERIFIER) private readonly verifier: AdminTokenVerifierPort | null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.configService.get<boolean>('ADMIN_AUTH_ENABLED') !== true || !this.verifier) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readBearerToken(request.headers?.authorization);

    if (!token) {
      throw new UnauthorizedException('Missing bearer access token');
    }

    let claims: JWTPayload;
    try {
      claims = await this.verifier.verify(token);
    } catch (error) {
      // The caller only ever sees a generic 401, but an operator debugging a misconfigured app
      // registration needs the actual reason, so it is logged server-side with the unverified
      // claims that identify which token arrived.
      this.logger.warn(
        `ADMIN_TOKEN_REJECTED reason=${
          error instanceof Error ? error.message : 'unknown'
        } ${describeUnverifiedToken(token)}`,
      );
      throw new UnauthorizedException('Invalid access token');
    }

    // Authenticated but unassigned is a 403, not a 401: signing in again cannot help.
    const requiredRoles = parseAdminRequiredRoles(
      this.configService.get<string>('ADMIN_REQUIRED_ROLES'),
    );
    if (!hasAnyRequiredRole(claims.roles, requiredRoles)) {
      this.logger.warn(
        `ADMIN_ROLE_MISSING required=[${requiredRoles.join(',')}] granted=${JSON.stringify(claims.roles ?? null)}`,
      );
      throw new ForbiddenException(
        `Your account is not assigned an app role that may read admin data (one of: ${requiredRoles.join(', ')})`,
      );
    }

    request.adminTokenClaims = claims;

    return true;
  }
}
