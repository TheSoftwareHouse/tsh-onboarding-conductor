import {
  Catch,
  HttpException,
  Injectable,
  Logger,
  type ArgumentsHost,
  type OnModuleDestroy,
} from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { isApiRequest } from '../admin-panel/admin-panel-static';
import { resolveOperatorId, type AdminAuthenticatedRequest } from '../auth/azure-jwt.guard';
import { isAuditRecorded } from './audit-recorded.marker';
import { AuditService } from './audit.service';
import {
  ADMIN_ACCESS_UNKNOWN_ACTOR,
  stampAuditEvent,
  type AdminAccessActorType,
  type ApiFailureAuditAction,
  type ApiFailureAuditMetadata,
  type ApiFailureFieldErrors,
} from './audit.types';

/**
 * How many scheduled `api.*` audit writes may be in flight before further ones are dropped.
 * Deliberately lower than the connector family's `MAX_PENDING_CONNECTOR_FAILURE_AUDITS` (100):
 * `logApiFailure` opens a full `dataSource.transaction()` per row, and `app.module.ts` sets no
 * `extra.max` on the Postgres pool, so it runs at node-postgres's default of 10 connections - a
 * cap of 100 would bound queue depth but not pool occupancy. Unlike a connector failure, which
 * requires an authenticated submit, a `/v1` 4xx is anonymous-reachable (a bad-body
 * `POST /v1/onboardings`, any unmatched `/v1/*` path), so an unauthenticated caller alone can
 * drive the fan-out. Sitting below the pool size leaves headroom for live request traffic;
 * writes past the cap are dropped with `logger.error`, which is the existing, intended behaviour.
 */
export const MAX_PENDING_API_FAILURE_AUDITS = 8;

/** How long shutdown waits for scheduled audit writes to drain before giving up on them. */
const API_FAILURE_AUDIT_FLUSH_TIMEOUT_MS = 5000;

/** `audit_log.resource_id` is `VARCHAR(255)`. */
const API_FAILURE_RESOURCE_ID_MAX_LENGTH = 255;

/**
 * Bounds every other caller-controlled string this filter records into `metadata` - the raw-path
 * `route` fallback, each `routeParams` value, and each `fieldErrors` key. `audit_log.metadata` is
 * JSONB, so nothing at the column level stops an oversized value; this is the only bound. Matches
 * {@link API_FAILURE_RESOURCE_ID_MAX_LENGTH} in size but kept as its own constant: that one bounds
 * a column, this one bounds row-size abuse.
 */
export const API_FAILURE_METADATA_STRING_MAX_LENGTH = 255;

/**
 * Caps how many `routeParams` entries a row retains, so a caller cannot trade one large value for
 * many small ones to defeat {@link API_FAILURE_METADATA_STRING_MAX_LENGTH}. No route in this
 * engine declares more than a handful of path parameters, so this is generous headroom, not a
 * realistic ceiling.
 */
export const API_FAILURE_MAX_ROUTE_PARAMS = 20;

/** Caps how many `fieldErrors` keys a row retains, for the same reason as {@link API_FAILURE_MAX_ROUTE_PARAMS}. */
export const API_FAILURE_MAX_FIELD_ERRORS = 20;

/**
 * Caps how many elements a single `fieldErrors` reasons array retains. The key count is capped by
 * {@link API_FAILURE_MAX_FIELD_ERRORS} and each key's length by
 * {@link API_FAILURE_METADATA_STRING_MAX_LENGTH}, but neither bounds the *length* of a single
 * `reasons` array - the same "many small items instead of one large one" loophole those two exist
 * to close, left open on the third dimension.
 */
export const API_FAILURE_MAX_FIELD_ERROR_REASONS = 20;

/**
 * Every legitimate `fieldErrors` reason in this codebase is a reason code or constraint key
 * (`REQUIRED`, `isNotEmpty`, `undeclared_key`) - never a rendered sentence. A rendered
 * class-validator message contains spaces and so cannot match.
 */
const API_FAILURE_FIELD_ERROR_REASON_PATTERN = /^[A-Za-z0-9_.:-]+$/;

/** A reason code is a short token, never prose - bounds it well above any real one in use. */
const API_FAILURE_FIELD_ERROR_REASON_MAX_LENGTH = 64;

function selectApiFailureAction(status: number): ApiFailureAuditAction {
  return status >= 500 ? 'api.request_failed' : 'api.request_rejected';
}

function readStatus(exception: unknown): number {
  return exception instanceof HttpException ? exception.getStatus() : 500;
}

/** The exception's `{ code, message, ... }` response payload, when it carries an object one. */
function readErrorPayload(exception: unknown): Record<string, unknown> | undefined {
  if (!(exception instanceof HttpException)) {
    return undefined;
  }

  const response = exception.getResponse();

  return typeof response === 'object' && response !== null
    ? (response as Record<string, unknown>)
    : undefined;
}

function readCode(payload: Record<string, unknown> | undefined): string | null {
  return typeof payload?.code === 'string' ? payload.code : null;
}

/** A reason code, never a rendered message - see {@link API_FAILURE_FIELD_ERROR_REASON_PATTERN}. */
function isIdentifierShapedReason(reason: string): boolean {
  return (
    reason.length > 0 &&
    reason.length <= API_FAILURE_FIELD_ERROR_REASON_MAX_LENGTH &&
    API_FAILURE_FIELD_ERROR_REASON_PATTERN.test(reason)
  );
}

/**
 * Accepts only a `Record<string, string[]>` whose every reason is identifier-shaped. A future
 * exception that puts a rendered message under `errors` fails this check - a sentence contains
 * spaces, so it can never match {@link API_FAILURE_FIELD_ERROR_REASON_PATTERN} - and the whole map
 * is rejected rather than partially trusted. No `instanceof` narrowing over specific exception
 * classes: that would import feature exception classes into the audit module, the coupling this
 * design deliberately avoids.
 */
function isFieldErrorsShape(value: unknown): value is ApiFailureFieldErrors {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value as Record<string, unknown>).every(
    (reasons) =>
      Array.isArray(reasons) &&
      reasons.every((reason) => typeof reason === 'string' && isIdentifierShapedReason(reason)),
  );
}

type ConnectorSettingsIssueLike = { key: string; reason: string };

function isConnectorSettingsIssueLike(value: unknown): value is ConnectorSettingsIssueLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { key?: unknown }).key === 'string' &&
    typeof (value as { reason?: unknown }).reason === 'string'
  );
}

/** `ConnectorSettingsInvalidException.issues` is `[{ key, reason }]`; folds it to `{ key: [reason] }`. */
function foldConnectorSettingsIssues(issues: readonly unknown[]): ApiFailureFieldErrors {
  // Null-prototype: these keys are caller-chosen connector setting names, and a key of
  // `__proto__` would otherwise make `??=` read `Object.prototype` and `.push` throw -
  // inside `catch`, after `super.catch` already sent the response.
  const folded: Record<string, string[]> = Object.create(null) as Record<string, string[]>;

  for (const issue of issues) {
    if (!isConnectorSettingsIssueLike(issue)) {
      continue;
    }

    (folded[issue.key] ??= []).push(issue.reason);
  }

  return folded;
}

/**
 * Truncates each key to {@link API_FAILURE_METADATA_STRING_MAX_LENGTH}, caps each reasons array to
 * {@link API_FAILURE_MAX_FIELD_ERROR_REASONS} elements, and keeps at most
 * {@link API_FAILURE_MAX_FIELD_ERRORS} entries - a submitted field name (and how many reasons it
 * carries) is caller-chosen, with no column bounding either, so this filter is the only limit on
 * how much of it a row carries.
 *
 * Two distinct keys can share a truncated prefix; the first occurrence wins and the colliding one
 * is dropped rather than silently overwriting it, so a row never misrepresents which field a
 * reason belongs to. Every cap or truncation that actually fires is logged via `logger.warn` -
 * `warn`, not `error`, because dropping caller-controlled excess here is the boundary working as
 * designed, not an operational failure - naming what was dropped so the shape of the input is
 * observable without changing the metadata contract.
 */
function boundFieldErrors(
  fieldErrors: ApiFailureFieldErrors,
  logger: Logger,
): ApiFailureFieldErrors {
  // Null-prototype for the same reason as `foldConnectorSettingsIssues`: these keys come from
  // submitted field names, and `bounded['__proto__'] = [...]` on a plain object sets the
  // prototype instead of adding a key, silently dropping the entry from the audit row.
  const bounded: Record<string, readonly string[]> = Object.create(null) as Record<
    string,
    readonly string[]
  >;
  const entries = Object.entries(fieldErrors);

  if (entries.length > API_FAILURE_MAX_FIELD_ERRORS) {
    logger.warn(
      `Dropped ${entries.length - API_FAILURE_MAX_FIELD_ERRORS} fieldErrors ` +
        `entr${entries.length - API_FAILURE_MAX_FIELD_ERRORS === 1 ? 'y' : 'ies'} past the ` +
        `${API_FAILURE_MAX_FIELD_ERRORS}-entry cap`,
    );
  }

  for (const [key, reasons] of entries) {
    if (Object.keys(bounded).length >= API_FAILURE_MAX_FIELD_ERRORS) {
      break;
    }

    const truncatedKey = key.slice(0, API_FAILURE_METADATA_STRING_MAX_LENGTH);

    if (Object.prototype.hasOwnProperty.call(bounded, truncatedKey)) {
      logger.warn(
        `Dropped fieldErrors key "${key}": collides with an earlier key after truncation to ` +
          `${API_FAILURE_METADATA_STRING_MAX_LENGTH} chars`,
      );
      continue;
    }

    if (reasons.length > API_FAILURE_MAX_FIELD_ERROR_REASONS) {
      logger.warn(
        `Truncated fieldErrors reasons for key "${truncatedKey}": ${reasons.length} capped to ` +
          `${API_FAILURE_MAX_FIELD_ERROR_REASONS}`,
      );
    }

    bounded[truncatedKey] = reasons.slice(0, API_FAILURE_MAX_FIELD_ERROR_REASONS);
  }

  return bounded;
}

/**
 * Never reads a `message`. Checks, in order: an instance `fieldErrors` property -
 * `ValidationFailedException` exposes one this shape without putting it in the response body, so
 * the 400 body stays byte-identical to Nest's default - then `InvalidStepDataException`'s
 * value-free `errors` map in the response payload, then `ConnectorSettingsInvalidException`'s
 * `issues` array, folded. Every candidate is validated by {@link isFieldErrorsShape} and bounded
 * by {@link boundFieldErrors} before being returned.
 */
function readFieldErrors(
  exception: unknown,
  payload: Record<string, unknown> | undefined,
  logger: Logger,
): ApiFailureFieldErrors | undefined {
  const instanceFieldErrors = (exception as { fieldErrors?: unknown } | null)?.fieldErrors;

  if (isFieldErrorsShape(instanceFieldErrors)) {
    return boundFieldErrors(instanceFieldErrors, logger);
  }

  if (isFieldErrorsShape(payload?.errors)) {
    return boundFieldErrors(payload?.errors as ApiFailureFieldErrors, logger);
  }

  if (Array.isArray(payload?.issues)) {
    const folded = foldConnectorSettingsIssues(payload.issues);

    return isFieldErrorsShape(folded) ? boundFieldErrors(folded, logger) : undefined;
  }

  return undefined;
}

/**
 * Only string-valued params - Express's `ParamsDictionary` also allows `string[]` per key. Each
 * value is caller-chosen path text, so it is truncated to
 * {@link API_FAILURE_METADATA_STRING_MAX_LENGTH}, and retention stops at
 * {@link API_FAILURE_MAX_ROUTE_PARAMS} entries.
 */
function readRouteParams(
  request: AdminAuthenticatedRequest,
): Readonly<Record<string, string>> | undefined {
  const params: Record<string, string> = {};

  for (const [key, value] of Object.entries(request.params ?? {})) {
    if (typeof value !== 'string') {
      continue;
    }

    if (Object.keys(params).length >= API_FAILURE_MAX_ROUTE_PARAMS) {
      break;
    }

    params[key] = value.slice(0, API_FAILURE_METADATA_STRING_MAX_LENGTH);
  }

  return Object.keys(params).length > 0 ? params : undefined;
}

function resolveActor(request: AdminAuthenticatedRequest): {
  actorType: AdminAccessActorType;
  actorId: string;
} {
  const { adminTokenClaims } = request;

  if (adminTokenClaims === undefined) {
    return { actorType: 'anonymous', actorId: ADMIN_ACCESS_UNKNOWN_ACTOR };
  }

  return { actorType: 'operator', actorId: resolveOperatorId(adminTokenClaims) };
}

/**
 * Global exception filter recording one `api.*` row for every rejected or unhandled response on
 * the `/v1` surface. Purely an observer: `catch` always delegates serialization to
 * `super.catch(...)` first, unchanged, and everything below that call only *reads* the exception
 * and the request to schedule a best-effort audit write - it never touches the response.
 *
 * Suppressed via `isAuditRecorded`: several throw sites already write a precise domain row before
 * throwing (see `markAuditRecorded`), and this filter must not turn that into a second row.
 * Scoped to `/v1`: every other path is answered with the admin panel's `index.html` and a 200
 * (`isApiRequest`), so there is nothing there to audit, and an unmatched-path flood must not
 * become an audit-write flood.
 */
@Injectable()
@Catch()
export class ApiFailureAuditFilter extends BaseExceptionFilter implements OnModuleDestroy {
  private readonly logger = new Logger(ApiFailureAuditFilter.name);

  /**
   * Writes scheduled but not yet settled. Bounded exactly like
   * `scheduleConnectorFailureAudit`/`flushConnectorFailureAudits`: an unauthenticated caller can
   * drive 4xx responses at will, so an unbounded write path is an availability problem, not just
   * an audit-completeness one.
   */
  private readonly pendingApiFailureAudits = new Set<Promise<void>>();

  constructor(
    httpAdapterHost: HttpAdapterHost,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) {
    super(httpAdapterHost.httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    super.catch(exception, host);

    this.recordFailure(exception, host.switchToHttp().getRequest<AdminAuthenticatedRequest>());
  }

  /** Schedules the failure row without touching the response, for failures `catch` never sees. */
  recordFailure(exception: unknown, request: AdminAuthenticatedRequest): void {
    if (!isApiRequest(request) || isAuditRecorded(exception)) {
      return;
    }

    this.scheduleApiFailureAudit(exception, request);
  }

  private scheduleApiFailureAudit(exception: unknown, request: AdminAuthenticatedRequest): void {
    if (this.pendingApiFailureAudits.size >= MAX_PENDING_API_FAILURE_AUDITS) {
      this.logger.error(
        `Dropped API failure audit for ${request.method} ${request.originalUrl ?? request.url}: ` +
          `${MAX_PENDING_API_FAILURE_AUDITS} writes are already in flight`,
      );

      return;
    }

    // Taken here, at the decision, not inside the write: scheduled writes run concurrently, so a
    // row stamped when it reached the database would sit in the trail wherever it won that race.
    const stamp = stampAuditEvent();
    const status = readStatus(exception);
    const method = (request.method ?? 'UNKNOWN').toUpperCase();
    const matchedRoute = request.route?.path;
    // The raw path is caller-controlled - Express permits multi-kilobyte URLs - so it is bounded
    // here, same as every other caller-controlled string this filter records.
    const route = (matchedRoute ?? request.path ?? 'unknown').slice(
      0,
      API_FAILURE_METADATA_STRING_MAX_LENGTH,
    );
    const resourceId = (matchedRoute ? `${method} ${matchedRoute}` : route).slice(
      0,
      API_FAILURE_RESOURCE_ID_MAX_LENGTH,
    );
    const payload = readErrorPayload(exception);
    const metadata: ApiFailureAuditMetadata = {
      method,
      route,
      status,
      code: readCode(payload),
      errorName: exception instanceof Error ? exception.name : 'UnknownError',
    };

    const routeParams = readRouteParams(request);

    if (routeParams) {
      metadata.routeParams = routeParams;
    }

    const fieldErrors = readFieldErrors(exception, payload, this.logger);

    if (fieldErrors) {
      metadata.fieldErrors = fieldErrors;
    }

    const { actorType, actorId } = resolveActor(request);

    const write = this.auditService
      .logApiFailure(this.dataSource, {
        action: selectApiFailureAction(status),
        actorType,
        actorId,
        resourceId,
        metadata,
        stamp,
      })
      .then(
        () => undefined,
        (auditError: unknown) => {
          this.logger.error(
            `Failed to record API failure audit for ${method} ${route}: ` +
              `${auditError instanceof Error ? auditError.message : String(auditError)}`,
          );
        },
      );

    this.pendingApiFailureAudits.add(write);
    void write.finally(() => this.pendingApiFailureAudits.delete(write));
  }

  /**
   * Drains scheduled writes on shutdown, so a rejection recorded moments before the process stops
   * is not lost with it. Bounded: nothing in the request path ever waits on these writes, and a
   * write blocked on a starved pool must not hold shutdown open either.
   */
  async onModuleDestroy(): Promise<void> {
    await this.flushApiFailureAudits(API_FAILURE_AUDIT_FLUSH_TIMEOUT_MS);
  }

  /**
   * Waits for every scheduled `api.*` audit write to settle, optionally giving up after
   * `timeoutMs`. Called on shutdown with a bound; tests call it without one as a deterministic
   * point to assert against instead of a sleep.
   */
  async flushApiFailureAudits(timeoutMs?: number): Promise<void> {
    const settled = Promise.all(this.pendingApiFailureAudits).then(() => undefined);

    if (timeoutMs === undefined) {
      return settled;
    }

    await Promise.race([
      settled,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref()),
    ]);
  }
}
