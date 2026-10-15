import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../../config/app.config';
import { AlgoanRequestRejectedError } from '../../../errors/algoan-request-rejected.error';
import { AlgoanUnavailableException } from '../../../errors/algoan-unavailable.exception';
import {
  ALGOAN_GRANT_TYPE_CLIENT_CREDENTIALS,
  ALGOAN_TOKEN_PATH,
  ALGOAN_TOKEN_REFRESH_MARGIN_MS,
  type AlgoanAnalysis,
  type AlgoanAnalysisRequest,
  type AlgoanCreditInsightKind,
  type AlgoanCredentials,
  type AlgoanCustomer,
  type AlgoanPage,
} from './algoan-contract';

type AlgoanHttpMethod = 'GET' | 'POST';

type CachedToken = Readonly<{ accessToken: string; refreshAtMs: number }>;

/** Same reading as `veriff-client.ts`: the class name tells a timeout from a refused connection. */
const errorName = (error: unknown): string => {
  const name = typeof error === 'object' && error !== null ? Reflect.get(error, 'name') : undefined;

  return typeof name === 'string' ? name : typeof error;
};

const MILLISECONDS_PER_SECOND = 1000;

/**
 * HTTP transport to Algoan, one method per endpoint the adapter calls. `clientId` and
 * `clientSecret` live in the `connectors` table and are editable at runtime, so every method takes
 * them as an argument; only the short-lived bearer token is cached, keyed by client id, and it is
 * never logged. `fetch` under `AbortSignal.timeout`, no provider SDK. A 4xx surfaces as
 * `AlgoanRequestRejectedError`; every other failure as `AlgoanUnavailableException`.
 */
@Injectable()
export class AlgoanClient {
  private readonly logger = new Logger(AlgoanClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly tokens = new Map<string, CachedToken>();

  constructor(configService: ConfigService<AppConfig, true>) {
    this.baseUrl = configService.getOrThrow<string>('ALGOAN_API_BASE_URL').replace(/\/+$/, '');
    this.timeoutMs = configService.getOrThrow<number>('ALGOAN_TIMEOUT_MS');
  }

  /**
   * `POST /v1/oauth/token`, form-encoded. The token is cached until `expires_in` minus the refresh
   * margin and keyed by client id.
   */
  async getToken(credentials: AlgoanCredentials): Promise<string> {
    const cached = this.tokens.get(credentials.clientId);

    if (cached && Date.now() < cached.refreshAtMs) {
      return cached.accessToken;
    }

    const parsed = this.asRecord(
      await this.call(
        'POST',
        ALGOAN_TOKEN_PATH,
        {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        new URLSearchParams({
          grant_type: ALGOAN_GRANT_TYPE_CLIENT_CREDENTIALS,
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
        }).toString(),
      ),
    );
    const { access_token: accessToken, expires_in: expiresIn } = parsed;

    if (typeof accessToken !== 'string' || typeof expiresIn !== 'number') {
      throw new AlgoanUnavailableException();
    }

    this.tokens.set(credentials.clientId, {
      accessToken,
      refreshAtMs:
        Date.now() + expiresIn * MILLISECONDS_PER_SECOND - ALGOAN_TOKEN_REFRESH_MARGIN_MS,
    });

    return accessToken;
  }

  /** `POST /v2/customers`; a reused identifier is a 422 `ALREADY_EXISTS` rejection. */
  async createCustomer(
    credentials: AlgoanCredentials,
    customIdentifier: string,
  ): Promise<AlgoanCustomer> {
    return this.parseCustomer(
      await this.authorized(credentials, 'POST', '/v2/customers', { customIdentifier }),
    );
  }

  /** `GET /v2/customers?filter=<json>`; `undefined` when no customer carries the identifier. */
  async findCustomerByIdentifier(
    credentials: AlgoanCredentials,
    customIdentifier: string,
  ): Promise<AlgoanCustomer | undefined> {
    const filter = encodeURIComponent(JSON.stringify({ customIdentifier }));
    const page = this.parsePage(
      await this.authorized(credentials, 'GET', `/v2/customers?filter=${filter}`),
    );
    const [first] = page.resources;

    return first ? this.parseCustomer(first) : undefined;
  }

  /** `GET /v2/customers/{id}`. */
  async getCustomer(credentials: AlgoanCredentials, customerId: string): Promise<AlgoanCustomer> {
    return this.parseCustomer(
      await this.authorized(credentials, 'GET', `/v2/customers/${encodeURIComponent(customerId)}`),
    );
  }

  /** `POST /v2/customers/{id}/analyses`. */
  async createAnalysis(
    credentials: AlgoanCredentials,
    customerId: string,
    body: AlgoanAnalysisRequest,
  ): Promise<AlgoanAnalysis> {
    return this.parseAnalysis(
      await this.authorized(credentials, 'POST', this.analysesPath(customerId), body),
    );
  }

  /** `GET /v2/customers/{id}/analyses/{analysisId}`. */
  async getAnalysis(
    credentials: AlgoanCredentials,
    customerId: string,
    analysisId: string,
  ): Promise<AlgoanAnalysis> {
    return this.parseAnalysis(
      await this.authorized(credentials, 'GET', this.analysisPath(customerId, analysisId)),
    );
  }

  /** `GET …/analyses/{analysisId}/scores`. */
  async getScores(
    credentials: AlgoanCredentials,
    customerId: string,
    analysisId: string,
  ): Promise<Record<string, unknown>> {
    return this.asRecord(
      await this.authorized(
        credentials,
        'GET',
        `${this.analysisPath(customerId, analysisId)}/scores`,
      ),
    );
  }

  /**
   * `GET …/analyses/{analysisId}/credit-insights/{kind}`. Every section is an object except
   * `cash-flows`, which Algoan answers as an array.
   */
  async getCreditInsights(
    credentials: AlgoanCredentials,
    customerId: string,
    analysisId: string,
    kind: AlgoanCreditInsightKind,
  ): Promise<Record<string, unknown> | readonly unknown[]> {
    const body = await this.authorized(
      credentials,
      'GET',
      `${this.analysisPath(customerId, analysisId)}/credit-insights/${kind}`,
    );

    return Array.isArray(body) ? body : this.asRecord(body);
  }

  /** `GET …/analyses/{analysisId}/essentials`. */
  async getEssentials(
    credentials: AlgoanCredentials,
    customerId: string,
    analysisId: string,
  ): Promise<Record<string, unknown>> {
    return this.asRecord(
      await this.authorized(
        credentials,
        'GET',
        `${this.analysisPath(customerId, analysisId)}/essentials`,
      ),
    );
  }

  /** `GET …/analyses/{analysisId}/transactions?page=<n>`; `hasNext` tells whether to ask for more. */
  async listTransactions(
    credentials: AlgoanCredentials,
    customerId: string,
    analysisId: string,
    page: number,
    limit?: number,
  ): Promise<AlgoanPage> {
    const query = new URLSearchParams({ page: String(page) });

    if (limit !== undefined) {
      query.set('limit', String(limit));
    }

    return this.parsePage(
      await this.authorized(
        credentials,
        'GET',
        `${this.analysisPath(customerId, analysisId)}/transactions?${query.toString()}`,
      ),
    );
  }

  /** `GET …/analyses/{analysisId}/accounts`. */
  async listAccounts(
    credentials: AlgoanCredentials,
    customerId: string,
    analysisId: string,
  ): Promise<AlgoanPage> {
    return this.parsePage(
      await this.authorized(
        credentials,
        'GET',
        `${this.analysisPath(customerId, analysisId)}/accounts`,
      ),
    );
  }

  private analysesPath(customerId: string): string {
    return `/v2/customers/${encodeURIComponent(customerId)}/analyses`;
  }

  private analysisPath(customerId: string, analysisId: string): string {
    return `${this.analysesPath(customerId)}/${encodeURIComponent(analysisId)}`;
  }

  private async authorized(
    credentials: AlgoanCredentials,
    method: AlgoanHttpMethod,
    path: string,
    payload?: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const token = await this.getToken(credentials);
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };

    if (payload) {
      headers['Content-Type'] = 'application/json';
    }

    return this.call(method, path, headers, payload ? JSON.stringify(payload) : undefined);
  }

  private async call(
    method: AlgoanHttpMethod,
    path: string,
    headers: Readonly<Record<string, string>>,
    body?: string,
  ): Promise<unknown> {
    // The query string can carry a customer identifier; log the path alone.
    const loggedPath = path.split('?')[0];

    this.logger.debug(`ALGOAN_REQUEST method=${method} path=${loggedPath}`);

    const response = await this.send(method, path, headers, body);
    const text = await this.readText(response);

    if (response.ok) {
      return this.parseJson(text);
    }

    this.logger.warn(
      `ALGOAN_RESPONSE_ERROR method=${method} path=${loggedPath} status=${response.status}`,
    );

    if (response.status >= 400 && response.status < 500) {
      throw this.toRejection(response.status, text);
    }

    throw new AlgoanUnavailableException();
  }

  private async send(
    method: AlgoanHttpMethod,
    path: string,
    headers: Readonly<Record<string, string>>,
    body?: string,
  ): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      this.logger.warn(
        `ALGOAN_REQUEST_FAILED method=${method} path=${path.split('?')[0]} ` +
          `error=${errorName(error)} timeoutMs=${this.timeoutMs}`,
      );
      throw new AlgoanUnavailableException();
    }
  }

  private async readText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      throw new AlgoanUnavailableException();
    }
  }

  private parseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new AlgoanUnavailableException();
    }
  }

  private toRejection(status: number, text: string): AlgoanRequestRejectedError {
    let record: Record<string, unknown> = {};

    try {
      const parsed: unknown = JSON.parse(text);

      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        record = parsed as Record<string, unknown>;
      }
    } catch {
      // A non-JSON error body still rejects; it just carries no Algoan code.
    }

    return new AlgoanRequestRejectedError(
      status,
      typeof record.code === 'string' ? record.code : undefined,
      typeof record.message === 'string' ? record.message : undefined,
    );
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new AlgoanUnavailableException();
    }

    return value as Record<string, unknown>;
  }

  private optionalRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private parseCustomer(value: unknown): AlgoanCustomer {
    const record = this.asRecord(value);

    if (typeof record.id !== 'string' || typeof record.customIdentifier !== 'string') {
      throw new AlgoanUnavailableException();
    }

    return { id: record.id, customIdentifier: record.customIdentifier };
  }

  private parseAnalysis(value: unknown): AlgoanAnalysis {
    const record = this.asRecord(value);

    if (typeof record.id !== 'string' || typeof record.status !== 'string') {
      throw new AlgoanUnavailableException();
    }

    const error = this.optionalRecord(record.error);

    return {
      id: record.id,
      status: record.status,
      scores: this.optionalRecord(record.scores),
      creditInsights: this.optionalRecord(record.creditInsights),
      metadata: this.optionalRecord(record.metadata),
      error: error
        ? {
            code: typeof error.code === 'string' ? error.code : undefined,
            message: typeof error.message === 'string' ? error.message : undefined,
          }
        : undefined,
    };
  }

  private parsePage(value: unknown): AlgoanPage {
    const record = this.asRecord(value);

    if (!Array.isArray(record.resources)) {
      throw new AlgoanUnavailableException();
    }

    const pagination = this.optionalRecord(record.pagination) ?? {};

    return {
      resources: record.resources.map((resource) => this.asRecord(resource)),
      pagination,
      hasNext: typeof pagination.next === 'string' && pagination.next.length > 0,
    };
  }
}
