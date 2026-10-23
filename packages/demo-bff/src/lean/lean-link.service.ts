import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppConfig } from '../config/app.config';
import { LeanUnavailableException } from './errors/lean-unavailable.exception';

const TOKEN_PATH = '/oauth2/token';
const CUSTOMERS_PATH = '/customers/v1';
const CUSTOMER_BY_APP_USER_ID_PATH = '/customers/v1/app-user-id';
const GRANT_TYPE = 'client_credentials';
const SCOPE_API = 'api';
const SCOPE_CUSTOMER_PREFIX = 'customer.';
const HTTP_NOT_FOUND = 404;
const HTTP_OK_BELOW = 300;
const SANDBOX_HOST_MARKER = 'sandbox';

/** What `Lean.connect` is called with; the permissions the KSA journey needs (ADR 0049). */
export const LEAN_PERMISSIONS = ['identity', 'accounts', 'balance', 'transactions'] as const;
export const LEAN_ACCOUNT_TYPE_PERSONAL = 'PERSONAL';

/** The redirect query the web app reads when the bank sends the customer back. */
export const LEAN_REDIRECT_QUERY = 'lean_redirect';
export const LEAN_REDIRECT_SUCCESS = 'success';
export const LEAN_REDIRECT_FAIL = 'fail';

export interface LeanLink {
  /** Lean's app token: the client id, public by design. */
  appToken: string;
  customerId: string;
  /** Customer-scoped, short-lived; the only token a browser ever receives. */
  accessToken: string;
  sandbox: boolean;
  permissions: readonly string[];
  accountType: string;
  successRedirectUrl: string;
  failRedirectUrl: string;
}

type LeanResponse = { status: number; body: Record<string, unknown> | null };

/**
 * The host-service half of Lean's widget (ADR 0049, 0052): creates or finds the Lean customer for
 * an onboarding and mints the customer-scoped token the widget needs. The client secret and the
 * API token stay in this process; nothing here logs a header, a body or a token.
 */
@Injectable()
export class LeanLinkService {
  private readonly logger = new Logger(LeanLinkService.name);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly authBaseUrl: string;
  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<AppConfig, true>) {
    this.clientId = config.get('LEAN_CLIENT_ID', { infer: true }) ?? '';
    this.clientSecret = config.get('LEAN_CLIENT_SECRET', { infer: true }) ?? '';
    this.authBaseUrl = (config.get('LEAN_AUTH_BASE_URL', { infer: true }) ?? '').replace(
      /\/+$/,
      '',
    );
    this.apiBaseUrl = (config.get('LEAN_API_BASE_URL', { infer: true }) ?? '').replace(/\/+$/, '');
    this.timeoutMs = config.get('ENGINE_REQUEST_TIMEOUT_MS', { infer: true });
  }

  /** Whether `LEAN_API_BASE_URL` is Lean's sandbox, which is what the widget's `sandbox` flag says. */
  get sandbox(): boolean {
    return this.apiBaseUrl.includes(SANDBOX_HOST_MARKER);
  }

  /**
   * The customer for `appUserId` (the onboarding id), created when Lean has none, and a token
   * scoped to it. The redirect URLs are the caller's: the bank sends the customer back there.
   */
  async createLink(
    appUserId: string,
    redirects: { success: string; fail: string },
  ): Promise<LeanLink> {
    const apiToken = await this.mintToken(SCOPE_API);
    const customerId = await this.ensureCustomer(apiToken, appUserId);
    const accessToken = await this.mintToken(`${SCOPE_CUSTOMER_PREFIX}${customerId}`);

    return {
      appToken: this.clientId,
      customerId,
      accessToken,
      sandbox: this.sandbox,
      permissions: LEAN_PERMISSIONS,
      accountType: LEAN_ACCOUNT_TYPE_PERSONAL,
      successRedirectUrl: redirects.success,
      failRedirectUrl: redirects.fail,
    };
  }

  private async mintToken(scope: string): Promise<string> {
    const result = await this.request(`${this.authBaseUrl}${TOKEN_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: GRANT_TYPE,
        scope,
      }).toString(),
    });
    const accessToken = result.body?.access_token;

    if (result.status >= HTTP_OK_BELOW || typeof accessToken !== 'string') {
      // The scope's first word names which token failed; a customer id is not a secret.
      this.logger.warn(`Lean token endpoint answered ${result.status} for scope ${scope}`);
      throw new LeanUnavailableException();
    }

    return accessToken;
  }

  /**
   * Lean's duplicate-create answer is not documented, so look up first, then create, then look up
   * once more when the create is refused: a concurrent request for the same onboarding wins.
   */
  private async ensureCustomer(apiToken: string, appUserId: string): Promise<string> {
    const existing = await this.findCustomer(apiToken, appUserId);

    if (existing !== null) {
      return existing;
    }

    const created = await this.lean('POST', CUSTOMERS_PATH, apiToken, { app_user_id: appUserId });
    const createdId = created.body?.customer_id;

    if (created.status < HTTP_OK_BELOW && typeof createdId === 'string') {
      return createdId;
    }

    const raced = await this.findCustomer(apiToken, appUserId);

    if (raced !== null) {
      return raced;
    }

    this.logger.warn(`Lean create-customer answered ${created.status}`);
    throw new LeanUnavailableException();
  }

  private async findCustomer(apiToken: string, appUserId: string): Promise<string | null> {
    const result = await this.lean(
      'GET',
      `${CUSTOMER_BY_APP_USER_ID_PATH}/${encodeURIComponent(appUserId)}`,
      apiToken,
    );

    if (result.status === HTTP_NOT_FOUND) {
      return null;
    }

    const customerId = result.body?.customer_id;

    if (result.status >= HTTP_OK_BELOW || typeof customerId !== 'string') {
      this.logger.warn(`Lean get-customer-by-app-user-id answered ${result.status}`);
      throw new LeanUnavailableException();
    }

    return customerId;
  }

  private lean(
    method: 'GET' | 'POST',
    path: string,
    apiToken: string,
    payload?: Record<string, unknown>,
  ): Promise<LeanResponse> {
    return this.request(`${this.apiBaseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiToken}`,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  }

  private async request(url: string, init: RequestInit): Promise<LeanResponse> {
    let response: Response;

    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      this.logger.warn(
        `Lean is unreachable at ${new URL(url).host} (${error instanceof Error ? error.name : 'error'})`,
      );
      throw new LeanUnavailableException();
    }

    const text = await response.text();
    let body: Record<string, unknown> | null = null;

    try {
      const parsed: unknown = text === '' ? null : JSON.parse(text);
      body =
        typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      body = null;
    }

    return { status: response.status, body };
  }
}
