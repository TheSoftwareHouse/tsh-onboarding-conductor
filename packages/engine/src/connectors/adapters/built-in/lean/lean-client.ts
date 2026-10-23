import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../../config/app.config';
import { LeanUnavailableException } from '../../../errors/lean-unavailable.exception';
import {
  LEAN_ACCOUNT_DETAILS_TYPE_IBAN,
  LEAN_ACCOUNT_HOLDER_TYPE_PERSONAL,
  LEAN_ASYNC_DISABLED,
  LEAN_COUNTRY_CODE_SAUDI_ARABIA,
  LEAN_DATA_PAGE_SIZE,
  LEAN_ERROR_STATUS_UNRECOGNIZED,
  LEAN_GRANT_TYPE_CLIENT_CREDENTIALS,
  LEAN_HTTP_STATUS_ACCEPTED,
  LEAN_HTTP_STATUS_NOT_IMPLEMENTED,
  LEAN_HTTP_STATUS_SERVER_ERROR_FROM,
  LEAN_HTTP_STATUS_UNAUTHORIZED,
  LEAN_IDENTIFICATION_TYPE_NATIONAL_ID,
  LEAN_INCOME_TYPE_ALL,
  LEAN_PATH_ACCOUNT_BALANCES_SUFFIX,
  LEAN_PATH_ACCOUNT_TRANSACTIONS_SUFFIX,
  LEAN_PATH_ACCOUNTS,
  LEAN_PATH_CUSTOMER_BY_APP_USER_ID,
  LEAN_PATH_CUSTOMER_ENTITIES_SUFFIX,
  LEAN_PATH_CUSTOMERS,
  LEAN_PATH_EMPLOYMENT,
  LEAN_PATH_INCOME,
  LEAN_PATH_TOKEN,
  LEAN_PATH_VERIFY_ACCOUNT,
  LEAN_SCOPE_API,
  LEAN_TOKEN_REFRESH_MARGIN_MS,
  type LeanAccountVerification,
  type LeanAccountsResponse,
  type LeanBalancesResponse,
  type LeanCredentials,
  type LeanCustomer,
  type LeanEmployment,
  type LeanEmploymentRequest,
  type LeanEntity,
  type LeanErrorBody,
  type LeanIncome,
  type LeanIncomeRequest,
  type LeanPendingBody,
  type LeanTokenResponse,
  type LeanTransactionsRequest,
  type LeanTransactionsResponse,
  type LeanVerifyAccountRequest,
} from './lean-contract';

/** A 2xx answer, or a 4xx answer whose body Lean's own error vocabulary describes. */
export type LeanResult<T> =
  | Readonly<{ kind: 'ok'; body: T }>
  | Readonly<{ kind: 'error'; httpStatus: number; body: LeanErrorBody }>;

/**
 * The insights endpoints answer `202` while the result is still being computed and `501` when the
 * bank cannot serve a synchronous request; both are outcomes the caller routes on, not failures.
 */
export type LeanInsightsResult<T> =
  | LeanResult<T>
  | Readonly<{ kind: 'pending'; body: LeanPendingBody }>
  | Readonly<{ kind: 'unsupported'; body: LeanErrorBody }>;

type LeanHttpMethod = 'GET' | 'POST';

type LeanRequest = Readonly<{
  method: LeanHttpMethod;
  path: string;
  query?: Readonly<Record<string, string>>;
  payload?: Readonly<Record<string, unknown>>;
}>;

type LeanRawResponse = Readonly<{ status: number; body: unknown }>;

type CachedToken = Readonly<{ accessToken: string; refreshAtMs: number }>;

const HTTP_STATUS_OK_FROM = 200;
const HTTP_STATUS_OK_BELOW = 300;
const MILLISECONDS_PER_SECOND = 1000;

const isSuccess = (status: number): boolean =>
  status >= HTTP_STATUS_OK_FROM && status < HTTP_STATUS_OK_BELOW;

/**
 * The class name tells a timeout from a refused connection; the message could carry a URL. Read
 * structurally because a `DOMException` need not be an `Error` of this realm.
 */
const errorName = (error: unknown): string => {
  const name = typeof error === 'object' && error !== null ? Reflect.get(error, 'name') : undefined;

  return typeof name === 'string' ? name : typeof error;
};

/**
 * HTTP transport to Lean's KSA API, one method per endpoint the adapters call. Authenticates with
 * an OAuth `client_credentials` token cached per credential pair. Credentials live in the
 * `connectors` table and are editable at runtime, so every method takes the resolved pair as an
 * argument and a changed pair simply misses the cache (ADR 0001). `fetch` under
 * `AbortSignal.timeout`, no provider SDK.
 *
 * A timeout, a refused connection, a `5xx` or an unreadable body surfaces as
 * `LeanUnavailableException`. A `4xx` is returned to the caller as a typed result, because the
 * adapters map `INVALID_PARAMETERS`, `UNKNOWN_CUSTOMER` and the like to outcomes of their own.
 * The client never logs a token, a secret, an IBAN or a national ID.
 */
@Injectable()
export class LeanClient {
  private readonly logger = new Logger(LeanClient.name);
  private readonly authBaseUrl: string;
  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly tokens = new Map<string, CachedToken>();

  constructor(configService: ConfigService<AppConfig, true>) {
    this.authBaseUrl = configService.getOrThrow<string>('LEAN_AUTH_BASE_URL');
    this.apiBaseUrl = configService.getOrThrow<string>('LEAN_API_BASE_URL');
    this.timeoutMs = configService.getOrThrow<number>('LEAN_TIMEOUT_MS');
  }

  /** `POST /verifications/v1/accounts` — IBAN ownership against a Saudi national ID. */
  async verifyAccount(
    credentials: LeanCredentials,
    request: LeanVerifyAccountRequest,
  ): Promise<LeanResult<LeanAccountVerification>> {
    return this.toResult(
      await this.call(credentials, {
        method: 'POST',
        path: LEAN_PATH_VERIFY_ACCOUNT,
        payload: {
          country_code: LEAN_COUNTRY_CODE_SAUDI_ARABIA,
          type: LEAN_ACCOUNT_HOLDER_TYPE_PERSONAL,
          account_details: { type: LEAN_ACCOUNT_DETAILS_TYPE_IBAN, value: request.iban },
          identifications: [
            { type: LEAN_IDENTIFICATION_TYPE_NATIONAL_ID, value: request.nationalId },
          ],
        },
      }),
    );
  }

  /** `GET /customers/v1/{customer_id}`; an unknown id is a typed `UNKNOWN_CUSTOMER` error. */
  async getCustomer(
    credentials: LeanCredentials,
    customerId: string,
  ): Promise<LeanResult<LeanCustomer>> {
    return this.toResult(
      await this.call(credentials, {
        method: 'GET',
        path: `${LEAN_PATH_CUSTOMERS}/${encodeURIComponent(customerId)}`,
      }),
    );
  }

  /** `GET /customers/v1/app-user-id/{app_user_id}`; unknown is a typed `UNKNOWN_APP_USER` error. */
  async findCustomerByAppUserId(
    credentials: LeanCredentials,
    appUserId: string,
  ): Promise<LeanResult<LeanCustomer>> {
    return this.toResult(
      await this.call(credentials, {
        method: 'GET',
        path: `${LEAN_PATH_CUSTOMER_BY_APP_USER_ID}/${encodeURIComponent(appUserId)}`,
      }),
    );
  }

  /** `POST /customers/v1`; `app_user_id` is unique, so a repeat is a typed 4xx error. */
  async createCustomer(
    credentials: LeanCredentials,
    appUserId: string,
  ): Promise<LeanResult<LeanCustomer>> {
    return this.toResult(
      await this.call(credentials, {
        method: 'POST',
        path: LEAN_PATH_CUSTOMERS,
        payload: { app_user_id: appUserId },
      }),
    );
  }

  /** `GET /customers/v1/{customer_id}/entities` — one entity per bank the customer connected. */
  async listCustomerEntities(
    credentials: LeanCredentials,
    customerId: string,
  ): Promise<LeanResult<readonly LeanEntity[]>> {
    return this.toResult(
      await this.call(credentials, {
        method: 'GET',
        path: `${LEAN_PATH_CUSTOMERS}/${encodeURIComponent(customerId)}/${LEAN_PATH_CUSTOMER_ENTITIES_SUFFIX}`,
      }),
    );
  }

  /**
   * `POST /insights/v2/income?async=false` — the request is a `POST` with a JSON body, unlike
   * employment, which is a `GET` with a query.
   */
  async getIncome(
    credentials: LeanCredentials,
    request: LeanIncomeRequest,
  ): Promise<LeanInsightsResult<LeanIncome>> {
    return this.toInsightsResult(
      await this.call(credentials, {
        method: 'POST',
        path: LEAN_PATH_INCOME,
        query: { async: LEAN_ASYNC_DISABLED },
        payload: {
          entity_id: request.entityId,
          start_date: request.startDate,
          income_type: LEAN_INCOME_TYPE_ALL,
        },
      }),
    );
  }

  /** `GET /insights/v2/income/employment?async=false`. */
  async getEmployment(
    credentials: LeanCredentials,
    request: LeanEmploymentRequest,
  ): Promise<LeanInsightsResult<LeanEmployment>> {
    return this.toInsightsResult(
      await this.call(credentials, {
        method: 'GET',
        path: LEAN_PATH_EMPLOYMENT,
        query: {
          entity_id: request.entityId,
          start_date: request.startDate,
          async: LEAN_ASYNC_DISABLED,
        },
      }),
    );
  }

  /** `GET /data/v2/accounts?entity_id=` — every account the entity's consent covers. */
  async listAccounts(
    credentials: LeanCredentials,
    entityId: string,
  ): Promise<LeanResult<LeanAccountsResponse>> {
    return this.toResult(
      await this.call(credentials, {
        method: 'GET',
        path: LEAN_PATH_ACCOUNTS,
        query: { entity_id: entityId, size: String(LEAN_DATA_PAGE_SIZE) },
      }),
    );
  }

  /** `GET /data/v2/accounts/{account_id}/balances?entity_id=`. */
  async listBalances(
    credentials: LeanCredentials,
    entityId: string,
    accountId: string,
  ): Promise<LeanResult<LeanBalancesResponse>> {
    return this.toResult(
      await this.call(credentials, {
        method: 'GET',
        path: `${LEAN_PATH_ACCOUNTS}/${encodeURIComponent(accountId)}/${LEAN_PATH_ACCOUNT_BALANCES_SUFFIX}`,
        query: { entity_id: entityId },
      }),
    );
  }

  /** `GET /data/v2/accounts/{account_id}/transactions?entity_id=&start_date=&end_date=&page=&size=`, one page. */
  async listTransactions(
    credentials: LeanCredentials,
    request: LeanTransactionsRequest,
  ): Promise<LeanResult<LeanTransactionsResponse>> {
    return this.toResult(
      await this.call(credentials, {
        method: 'GET',
        path: `${LEAN_PATH_ACCOUNTS}/${encodeURIComponent(request.accountId)}/${LEAN_PATH_ACCOUNT_TRANSACTIONS_SUFFIX}`,
        query: {
          entity_id: request.entityId,
          start_date: request.startDate,
          end_date: request.endDate,
          page: String(request.page),
          size: String(LEAN_DATA_PAGE_SIZE),
        },
      }),
    );
  }

  /**
   * Sends the request with the cached `api` token. One `401` means the token Lean holds is no
   * longer the one cached (revoked, or rotated server-side), so it is refreshed and the request
   * repeated once; a second `401` is the caller's to see.
   */
  private async call(credentials: LeanCredentials, request: LeanRequest): Promise<LeanRawResponse> {
    const first = await this.send(request, await this.getApiToken(credentials, false));

    if (first.status !== LEAN_HTTP_STATUS_UNAUTHORIZED) {
      return first;
    }

    return this.send(request, await this.getApiToken(credentials, true));
  }

  private async send(request: LeanRequest, accessToken: string): Promise<LeanRawResponse> {
    const query = request.query ? `?${new URLSearchParams(request.query).toString()}` : '';
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };

    if (request.payload) {
      headers['Content-Type'] = 'application/json';
    }

    this.logger.debug(`LEAN_REQUEST method=${request.method} path=${request.path}`);

    const response = await this.fetchOrThrow(`${this.apiBaseUrl}${request.path}${query}`, {
      method: request.method,
      headers,
      body: request.payload ? JSON.stringify(request.payload) : undefined,
    });

    // `501` is Lean saying a bank cannot serve a synchronous insight, which the caller routes on.
    if (
      response.status >= LEAN_HTTP_STATUS_SERVER_ERROR_FROM &&
      response.status !== LEAN_HTTP_STATUS_NOT_IMPLEMENTED
    ) {
      this.logger.warn(
        `LEAN_RESPONSE_ERROR method=${request.method} path=${request.path} status=${response.status}`,
      );
      throw new LeanUnavailableException();
    }

    return { status: response.status, body: await this.readJson(response) };
  }

  /**
   * One `api`-scoped token per credential pair, refreshed `LEAN_TOKEN_REFRESH_MARGIN_MS` before
   * `expires_in`. The map key is a digest, so a secret is never held as a key.
   */
  private async getApiToken(credentials: LeanCredentials, forceRefresh: boolean): Promise<string> {
    const cacheKey = createHash('sha256')
      .update(JSON.stringify([credentials.clientId, credentials.clientSecret]))
      .digest('hex');
    const cached = this.tokens.get(cacheKey);

    if (!forceRefresh && cached && Date.now() < cached.refreshAtMs) {
      return cached.accessToken;
    }

    this.logger.debug(`LEAN_TOKEN_REQUEST path=${LEAN_PATH_TOKEN}`);

    const response = await this.fetchOrThrow(`${this.authBaseUrl}${LEAN_PATH_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: LEAN_GRANT_TYPE_CLIENT_CREDENTIALS,
        scope: LEAN_SCOPE_API,
      }).toString(),
    });

    if (!isSuccess(response.status)) {
      // Credentials Lean refuses are an integration failure, not an outcome of the step's data.
      this.logger.warn(`LEAN_TOKEN_ERROR status=${response.status}`);
      throw new LeanUnavailableException();
    }

    const token = (await this.readJson(response)) as Partial<LeanTokenResponse> | undefined;

    if (typeof token?.access_token !== 'string' || typeof token.expires_in !== 'number') {
      throw new LeanUnavailableException();
    }

    this.tokens.set(cacheKey, {
      accessToken: token.access_token,
      refreshAtMs:
        Date.now() + token.expires_in * MILLISECONDS_PER_SECOND - LEAN_TOKEN_REFRESH_MARGIN_MS,
    });

    return token.access_token;
  }

  private async fetchOrThrow(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      this.logger.warn(
        `LEAN_REQUEST_FAILED method=${init.method} error=${errorName(error)} ` +
          `timeoutMs=${this.timeoutMs}`,
      );
      throw new LeanUnavailableException();
    }
  }

  /** Lean's own answers are JSON; `undefined` is an empty or non-JSON body (a bare 401, say). */
  private async readJson(response: Response): Promise<unknown> {
    try {
      return JSON.parse(await response.text());
    } catch {
      return undefined;
    }
  }

  private toResult<T>(raw: LeanRawResponse): LeanResult<T> {
    if (isSuccess(raw.status)) {
      if (typeof raw.body !== 'object' || raw.body === null) {
        throw new LeanUnavailableException();
      }

      return { kind: 'ok', body: raw.body as T };
    }

    return { kind: 'error', httpStatus: raw.status, body: this.toErrorBody(raw) };
  }

  private toInsightsResult<T>(raw: LeanRawResponse): LeanInsightsResult<T> {
    if (raw.status === LEAN_HTTP_STATUS_ACCEPTED) {
      return { kind: 'pending', body: raw.body as LeanPendingBody };
    }

    if (raw.status === LEAN_HTTP_STATUS_NOT_IMPLEMENTED) {
      return { kind: 'unsupported', body: this.toErrorBody(raw) };
    }

    return this.toResult<T>(raw);
  }

  /** A 4xx without a JSON body still gets the shape callers branch on. */
  private toErrorBody(raw: LeanRawResponse): LeanErrorBody {
    const body = raw.body;

    if (
      typeof body === 'object' &&
      body !== null &&
      typeof Reflect.get(body, 'status') === 'string'
    ) {
      return body as LeanErrorBody;
    }

    return { status: LEAN_ERROR_STATUS_UNRECOGNIZED, message: '' };
  }
}
