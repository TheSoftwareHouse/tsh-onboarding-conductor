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
  ADMIN_ACCESS_AUDIT,
  EMPTY_TOKEN_DESCRIPTOR,
  type AdminAccessAuditEvent,
  type AdminAccessAuditPort,
  type AdminAccessEndpoint,
  type AdminOperatorIdentity,
  type UnverifiedTokenDescriptor,
} from './admin-access-audit.port';
import {
  ADMIN_TOKEN_VERIFIER,
  AdminTokenVerifierUnavailableError,
  type AdminTokenVerifierPort,
} from './admin-token-verifier.port';

const BEARER_PREFIX = 'bearer ';

const MAX_LOGGED_VALUE_LENGTH = 200;

/**
 * Caps how many roles reach the audit row. Entra emits one entry per assigned app role, so a
 * realistic token carries a handful; the bound exists so a crafted directory cannot grow the
 * stored metadata without limit.
 */
const MAX_AUDITED_ROLES = 32;

/** Clips an untrusted value so a single token cannot flood a log line or an audit row. */
function clipValue(text: string): string {
  return text.length > MAX_LOGGED_VALUE_LENGTH
    ? `${text.slice(0, MAX_LOGGED_VALUE_LENGTH)}…`
    : text;
}

/**
 * Renders an untrusted value for a log line. Everything read out of an unverified token is
 * attacker-controlled, so the value is JSON-quoted — which escapes the newlines that would
 * otherwise let a crafted token forge whole log entries — and clipped so it cannot flood the log.
 */
export function quoteForLog(value: unknown): string {
  return JSON.stringify(clipValue(String(value)));
}

/** Reads a claim expected to hold a string, clipped. Anything else reads as absent. */
function readClaimString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? clipValue(value) : null;
}

/**
 * As {@link readClaimString}, but also accepts the numeric and boolean forms a hand-rolled token
 * can put where a string belongs — `ver: 2` rather than `ver: "2.0"`, for instance.
 */
function readClaimScalar(value: unknown): string | null {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return readClaimString(value);
}

type AuthenticatedRequest = {
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  path?: string;
  route?: { path?: string };
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
 * Names the admin route for the audit trail. The registered route pattern is preferred over the
 * concrete path so that parameterized routes aggregate into one auditable resource rather than
 * one per id. The query string is deliberately left out: admin filters can carry the very
 * identifiers the trail exists to protect.
 */
export function readEndpoint(request: AuthenticatedRequest): AdminAccessEndpoint {
  const path = request.route?.path ?? request.path ?? 'unknown';

  return {
    method: (request.method ?? 'UNKNOWN').toUpperCase(),
    path: clipValue(path),
  };
}

/** The `roles` claim as Entra emits it: absent entirely for an account assigned no app role. */
export function readGrantedRoles(claim: unknown): string[] {
  return Array.isArray(claim)
    ? claim.filter((role): role is string => typeof role === 'string')
    : [];
}

/**
 * Parses the payload segment of a token that has not been verified. Used only to describe which
 * token turned up, never to decide anything.
 */
function parseUnverifiedClaims(token: string): Record<string, unknown> | null {
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );

    return typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The two views a rejection needs of a token nothing is known about. */
export type UnverifiedToken = {
  /** `iss`, `aud` and `ver` rendered for a log line, already escaped and clipped. */
  description: string;
  /** The same claims, shaped for the audit row. */
  descriptor: UnverifiedTokenDescriptor;
};

/**
 * Reads `iss`, `aud` and `ver` out of an unverified token, for the log line and the audit row
 * alike. These values are never trusted for a decision; they exist so a rejection says which
 * token turned up — a v1.0 token from `sts.windows.net`, for instance, is a configuration problem
 * rather than an attack.
 *
 * Every rejection needs both views, and the payload is entirely attacker-controlled, so it is
 * base64-decoded and parsed once here rather than once per view.
 */
export function readUnverifiedToken(token: string): UnverifiedToken {
  const payload = parseUnverifiedClaims(token);

  if (payload === null) {
    return { description: 'claims=unreadable', descriptor: EMPTY_TOKEN_DESCRIPTOR };
  }

  const { iss, aud, ver } = payload;

  return {
    description: `iss=${quoteForLog(iss)} aud=${quoteForLog(aud)} ver=${quoteForLog(ver)}`,
    descriptor: {
      issuer: readClaimString(iss),
      // `aud` is a string in every Entra access token, but the JWT spec permits an array.
      audience: Array.isArray(aud)
        ? readClaimString(aud.find((value) => typeof value === 'string'))
        : readClaimString(aud),
      version: readClaimScalar(ver),
    },
  };
}

/**
 * Names the operator behind a verified token. `oid` is Entra's immutable user id within the
 * directory and is what the audit trail is keyed on; `sub` is a pairwise identifier that differs
 * per application, so it serves only as a fallback. `preferred_username` is where a v2.0 token
 * carries the sign-in name, with `upn` and `email` covering directories that emit those instead.
 */
export function readOperatorIdentity(claims: JWTPayload): AdminOperatorIdentity {
  return {
    objectId: readClaimString(claims.oid) ?? readClaimString(claims.sub),
    userPrincipalName:
      readClaimString(claims.preferred_username) ??
      readClaimString(claims.upn) ??
      readClaimString(claims.email),
    tenantId: readClaimString(claims.tid),
    roles: readGrantedRoles(claims.roles).slice(0, MAX_AUDITED_ROLES).map(clipValue),
  };
}

/**
 * Checks the token's `roles` claim against the configured allowlist. Entra only emits the claim
 * for app roles the user is actually assigned, so an unassigned operator has no roles at all.
 * The comparison ignores case, because a role's configured spelling and its portal "Value" are
 * easy to drift apart and the failure would otherwise be a silent 403.
 */
export function hasAnyRequiredRole(claim: unknown, requiredRoles: readonly string[]): boolean {
  const grantedRoles = readGrantedRoles(claim).map((role) => role.toLowerCase());

  return requiredRoles.some((role) => grantedRoles.includes(role.toLowerCase()));
}

/**
 * Protects the admin read endpoints with a Microsoft Entra ID access token.
 *
 * A token that is read and found wanting is a 401, never a 500, so a rotated key or an expired
 * token cannot be mistaken for an engine outage. The converse matters just as much: when the
 * signing key set cannot be reached the token was never judged at all, and that is a 503, so an
 * operator is not sent to re-authenticate over a network fault.
 *
 * Every decision — including the successful ones — is written to the audit log, so the trail
 * answers "who read this data" and not only "who was turned away".
 *
 * Where a decision is logged as well as audited, the log event is the upper-snake form of the
 * audit action — `AUTH_TOKEN_REJECTED` for `auth.token_rejected` — so an operator reading the
 * logs can query the matching rows without a translation table. Keep that pairing when adding an
 * outcome. Successes are audited only; logging every admin read would double the volume for
 * something the trail already answers better.
 */
@Injectable()
export class AzureJwtGuard implements CanActivate {
  private readonly logger = new Logger(AzureJwtGuard.name);

  /**
   * Configuration validation already trims the allowlist and rejects an empty one whenever admin
   * auth is on, so it is split once here rather than re-parsed on every request.
   */
  private readonly requiredRoles: readonly string[];

  constructor(
    private readonly configService: ConfigService,
    @Inject(ADMIN_TOKEN_VERIFIER) private readonly verifier: AdminTokenVerifierPort | null,
    @Inject(ADMIN_ACCESS_AUDIT) private readonly accessAudit: AdminAccessAuditPort,
  ) {
    this.requiredRoles = parseAdminRequiredRoles(configService.get<string>('ADMIN_REQUIRED_ROLES'));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const endpoint = readEndpoint(request);

    if (this.configService.get<boolean>('ADMIN_AUTH_ENABLED') !== true || !this.verifier) {
      // Admin data is being served with no credential demanded of the caller. There is no
      // identity to attribute it to, which is exactly why the read still has to be recorded.
      this.recordAccess({ outcome: 'unauthenticated', endpoint });

      return true;
    }

    const token = readBearerToken(request.headers?.authorization);

    if (!token) {
      this.recordAccess({
        outcome: 'token_rejected',
        endpoint,
        reason: 'Missing bearer access token',
        token: EMPTY_TOKEN_DESCRIPTOR,
      });

      throw new UnauthorizedException('Missing bearer access token');
    }

    let claims: JWTPayload;
    try {
      claims = await this.verifier.verify(token);
    } catch (error) {
      const reason = clipValue(error instanceof Error ? error.message : 'unknown');

      // Entra's key set could not be reached, so nothing is known about this token. Answering 401
      // would send every operator off to re-authenticate over what is an engine-side fault, so
      // this is reported as the outage it is.
      if (error instanceof AdminTokenVerifierUnavailableError) {
        this.logger.error(`AUTH_VERIFICATION_UNAVAILABLE reason=${quoteForLog(error.message)}`);
        this.recordAccess({ outcome: 'verification_unavailable', endpoint, reason });

        throw new ServiceUnavailableException('Access token could not be verified right now');
      }

      // The caller only ever sees a generic 401, but an operator debugging a misconfigured app
      // registration needs the actual reason, so it is logged server-side with the unverified
      // claims that identify which token arrived.
      const unverified = readUnverifiedToken(token);

      this.logger.warn(
        `AUTH_TOKEN_REJECTED reason=${quoteForLog(reason)} ${unverified.description}`,
      );
      this.recordAccess({
        outcome: 'token_rejected',
        endpoint,
        reason,
        token: unverified.descriptor,
      });

      throw new UnauthorizedException('Invalid access token');
    }

    // Authenticated but unassigned is a 403, not a 401: signing in again cannot help.
    const { requiredRoles } = this;
    const operator = readOperatorIdentity(claims);

    if (!hasAnyRequiredRole(claims.roles, requiredRoles)) {
      this.logger.warn(
        `AUTH_ROLE_MISSING required=[${requiredRoles.join(',')}] granted=${JSON.stringify(operator.roles)}`,
      );
      this.recordAccess({ outcome: 'role_missing', endpoint, operator, requiredRoles });

      throw new ForbiddenException(
        `Your account is not assigned an app role that may read admin data (one of: ${requiredRoles.join(', ')})`,
      );
    }

    request.adminTokenClaims = claims;
    this.recordAccess({ outcome: 'granted', endpoint, operator });

    return true;
  }

  /**
   * Auditing is best effort by design: a failed write is reported on the engine's own logger but
   * never converted into a failed request, so a database outage cannot take the admin endpoints
   * down with it. The trade is a gap in the trail during such an outage, which the
   * `AUTH_AUDIT_WRITE_FAILED` line makes visible.
   */
  private recordAccess(event: AdminAccessAuditEvent): void {
    void this.accessAudit.record(event).catch((error: unknown) => {
      this.logger.error(
        `AUTH_AUDIT_WRITE_FAILED outcome=${event.outcome} method=${quoteForLog(
          event.endpoint.method,
        )} path=${quoteForLog(event.endpoint.path)} reason=${quoteForLog(
          error instanceof Error ? error.message : 'unknown',
        )}`,
      );
    });
  }
}
