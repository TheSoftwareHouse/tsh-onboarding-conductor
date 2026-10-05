import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../../config/app.config';
import { VeriffUnavailableException } from '../../../errors/veriff-unavailable.exception';
import {
  VERIFF_HEADER_AUTH_CLIENT,
  VERIFF_HEADER_HMAC_SIGNATURE,
  VERIFF_SESSION_STATUS_SUBMITTED,
  type VeriffMediaContext,
} from './veriff-contract';

/**
 * `apiKey` and `sharedSecretKey` live in the `connectors` table and are editable at runtime, so
 * every method takes the resolved pair as an argument; nothing is cached (ADR 0001).
 */
export type VeriffCredentials = Readonly<{ apiKey: string; sharedSecretKey: string }>;

export type VeriffPerson = Readonly<{
  firstName: string;
  lastName: string;
  dateOfBirth: string;
}>;

export type VeriffSessionRequest = Readonly<{
  vendorData: string;
  person: VeriffPerson;
  document?: Readonly<{ type: string; country: string }>;
}>;

export type VeriffSession = Readonly<{ id: string; status: string }>;

export type VeriffMediaUploadRequest = Readonly<{
  sessionId: string;
  context: VeriffMediaContext;
  contentType: string;
  content: Buffer;
}>;

export type VeriffDecision = Readonly<{
  id: string;
  attemptId?: string;
  status: string;
  code?: number;
  reason?: string;
  reasonCode?: number;
  vendorData?: string;
  person?: Readonly<Record<string, unknown>>;
  document?: Readonly<Record<string, unknown>>;
}>;

type VeriffHttpMethod = 'GET' | 'POST' | 'PATCH';

const SUCCESS_STATUS = 'success';

/**
 * Signed HTTP transport to Veriff, one method per endpoint the adapter calls. A body is signed as
 * the exact bytes sent; a bodyless GET is signed over the session id. `fetch` under
 * `AbortSignal.timeout`, no provider SDK. Every failure surfaces as `VeriffUnavailableException`.
 */
@Injectable()
export class VeriffClient {
  private readonly logger = new Logger(VeriffClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.baseUrl = configService.getOrThrow<string>('VERIFF_BASE_URL');
    this.timeoutMs = configService.getOrThrow<number>('VERIFF_TIMEOUT_MS');
  }

  /** `POST /v1/sessions`. */
  async createSession(
    credentials: VeriffCredentials,
    request: VeriffSessionRequest,
  ): Promise<VeriffSession> {
    const verification: Record<string, unknown> = {
      vendorData: request.vendorData,
      person: request.person,
      timestamp: new Date().toISOString(),
    };

    if (request.document) {
      verification.document = request.document;
    }

    const parsed = await this.sendJson(credentials, 'POST', '/v1/sessions', { verification });
    const record = this.asRecord(parsed);
    const created = this.asRecord(record.verification);

    if (record.status !== SUCCESS_STATUS || typeof created.id !== 'string') {
      throw new VeriffUnavailableException();
    }

    return {
      id: created.id,
      status: typeof created.status === 'string' ? created.status : SUCCESS_STATUS,
    };
  }

  /** `POST /v1/sessions/{id}/media` — the image travels as a base64 data URI. Returns the image id. */
  async uploadMedia(
    credentials: VeriffCredentials,
    request: VeriffMediaUploadRequest,
  ): Promise<string> {
    const parsed = await this.sendJson(
      credentials,
      'POST',
      `/v1/sessions/${request.sessionId}/media`,
      {
        image: {
          context: request.context,
          content: `data:${request.contentType};base64,${request.content.toString('base64')}`,
        },
      },
    );
    const imageId = this.asRecord(this.asRecord(parsed).image).id;

    if (typeof imageId !== 'string') {
      throw new VeriffUnavailableException();
    }

    return imageId;
  }

  /** `PATCH /v1/sessions/{id}` — closes the upload phase and starts the decision. */
  async submitSession(credentials: VeriffCredentials, sessionId: string): Promise<void> {
    await this.sendJson(credentials, 'PATCH', `/v1/sessions/${sessionId}`, {
      verification: { status: VERIFF_SESSION_STATUS_SUBMITTED },
    });
  }

  /**
   * `GET /v1/sessions/{id}/decision`. `verification: null` means no decision yet, returned as
   * `undefined`. The request is signed over the session id, there being no body.
   */
  async findDecision(
    credentials: VeriffCredentials,
    sessionId: string,
  ): Promise<VeriffDecision | undefined> {
    const response = await this.request(
      credentials,
      'GET',
      `/v1/sessions/${sessionId}/decision`,
      Buffer.from(sessionId, 'utf-8'),
    );
    const record = this.asRecord(await this.readJson(response));

    if (record.verification === null) {
      return undefined;
    }

    return this.parseDecision(this.asRecord(record.verification));
  }

  private async sendJson(
    credentials: VeriffCredentials,
    method: VeriffHttpMethod,
    path: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const body = Buffer.from(JSON.stringify(payload), 'utf-8');
    const response = await this.request(credentials, method, path, body, body);

    return this.readJson(response);
  }

  private async request(
    credentials: VeriffCredentials,
    method: VeriffHttpMethod,
    path: string,
    signedBytes: Buffer,
    body?: Buffer,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      [VERIFF_HEADER_AUTH_CLIENT]: credentials.apiKey,
      [VERIFF_HEADER_HMAC_SIGNATURE]: createHmac('sha256', credentials.sharedSecretKey)
        .update(signedBytes)
        .digest('hex'),
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    this.logger.debug(`VERIFF_REQUEST method=${method} path=${path}`);

    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        // A plain `Uint8Array` copy of the signed bytes satisfies `BodyInit`; `Buffer` does not.
        body: body ? new Uint8Array(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new VeriffUnavailableException();
    }

    if (!response.ok) {
      throw new VeriffUnavailableException();
    }

    return response;
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return JSON.parse(await response.text());
    } catch {
      throw new VeriffUnavailableException();
    }
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new VeriffUnavailableException();
    }

    return value as Record<string, unknown>;
  }

  private parseDecision(record: Record<string, unknown>): VeriffDecision {
    if (typeof record.id !== 'string' || typeof record.status !== 'string') {
      throw new VeriffUnavailableException();
    }

    return {
      id: record.id,
      attemptId: typeof record.attemptId === 'string' ? record.attemptId : undefined,
      status: record.status,
      code: typeof record.code === 'number' ? record.code : undefined,
      reason: typeof record.reason === 'string' ? record.reason : undefined,
      reasonCode: typeof record.reasonCode === 'number' ? record.reasonCode : undefined,
      vendorData: typeof record.vendorData === 'string' ? record.vendorData : undefined,
      person: this.optionalRecord(record.person),
      document: this.optionalRecord(record.document),
    };
  }

  private optionalRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }
}
