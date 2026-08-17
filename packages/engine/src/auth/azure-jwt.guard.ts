import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JWTPayload } from 'jose';
import { parseAdminRequiredRoles } from '../config/app.config';
import {
  ADMIN_TOKEN_VERIFIER,
  AdminTokenVerifierUnavailableError,
  type AdminTokenVerifierPort,
} from './admin-token-verifier.port';

const BEARER_PREFIX = 'bearer ';

const MAX_LOGGED_VALUE_LENGTH = 200;

/**
 * Renders an untrusted value for a log line. Everything read out of an unverified token is
 * attacker-controlled, so the value is JSON-quoted — which escapes the newlines that would
 * otherwise let a crafted token forge whole log entries — and clipped so it cannot flood the log.
 */
export function quoteForLog(value: unknown): string {
  const text = String(value);

  return JSON.stringify(
    text.length > MAX_LOGGED_VALUE_LENGTH ? `${text.slice(0, MAX_LOGGED_VALUE_LENGTH)}…` : text,
  );
}

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

    return `iss=${quoteForLog(iss)} aud=${quoteForLog(aud)} ver=${quoteForLog(ver)}`;
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
 * Protects the admin read endpoints with a Microsoft Entra ID access token.
 *
 * A token that is read and found wanting is a 401, never a 500, so a rotated key or an expired
 * token cannot be mistaken for an engine outage. The converse matters just as much: when the
 * signing key set cannot be reached the token was never judged at all, and that is a 503, so an
 * operator is not sent to re-authenticate over a network fault.
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
      // Entra's key set could not be reached, so nothing is known about this token. Answering 401
      // would send every operator off to re-authenticate over what is an engine-side fault, so
      // this is reported as the outage it is.
      if (error instanceof AdminTokenVerifierUnavailableError) {
        this.logger.error(`ADMIN_TOKEN_VERIFIER_UNAVAILABLE reason=${quoteForLog(error.message)}`);
        throw new ServiceUnavailableException('Access token could not be verified right now');
      }

      // The caller only ever sees a generic 401, but an operator debugging a misconfigured app
      // registration needs the actual reason, so it is logged server-side with the unverified
      // claims that identify which token arrived.
      this.logger.warn(
        `ADMIN_TOKEN_REJECTED reason=${quoteForLog(
          error instanceof Error ? error.message : 'unknown',
        )} ${describeUnverifiedToken(token)}`,
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
