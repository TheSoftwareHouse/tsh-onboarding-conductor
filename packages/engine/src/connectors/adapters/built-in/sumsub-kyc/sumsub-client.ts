import { createHmac, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../../config/app.config';
import { SumsubSubmissionIncompleteError } from '../../../errors/sumsub-submission-incomplete.error';
import { SumsubUnavailableException } from '../../../errors/sumsub-unavailable.exception';
import {
  SUMSUB_DOC_SET_KEYS,
  type SumsubDocSetKey,
  type SumsubReviewRejectType,
} from './sumsub-contract';

/**
 * `appToken` and `secretKey` live in the `connectors` table and are editable at runtime, so a
 * `SumsubClient` constructed with them would serve a stale secret from the moment an operator
 * rotates one. Every method takes the resolved pair as an argument instead.
 */
export type SumsubCredentials = Readonly<{ appToken: string; secretKey: string }>;

/** One entry of a level's `docSets` list — only the field the drift check needs. */
export type SumsubLevelDocSet = Readonly<{ idDocSetType: string }>;

export type SumsubLevel = Readonly<{ name: string; docSets: readonly SumsubLevelDocSet[] }>;

export type SumsubReviewResult = Readonly<{
  reviewAnswer?: string;
  reviewRejectType?: SumsubReviewRejectType;
  moderationComment?: string;
  buttonIds?: readonly string[];
}>;

export type SumsubApplicantStatus = Readonly<{
  reviewStatus: string;
  reviewResult?: SumsubReviewResult;
}>;

/** The verified `info` block from `GET /one` — a provider-shaped, genuinely dynamic payload. */
export type SumsubApplicantInfo = Readonly<Record<string, unknown>>;

export type SumsubRequiredIdDocsStatus = Readonly<Record<string, unknown>>;

export type SumsubAmlCase = Readonly<{ hits: readonly unknown[] }>;

export type SumsubIdDocUploadRequest = Readonly<{
  applicantId: string;
  metadata: Readonly<Record<string, unknown>>;
  fileName: string;
  contentType: string;
  fileContent: Buffer;
}>;

type SumsubHttpMethod = 'GET' | 'POST';

/** Sumsub's applicant ids are 24-character hex Mongo ObjectIds, quoted in the 409 description. */
const EXISTING_APPLICANT_ID_PATTERN = /applicant id:?\s*([0-9a-fA-F]{24})/i;

/**
 * Signed HTTP transport to Sumsub, one method per endpoint the adapter calls. Every request is
 * HMAC-SHA256 signed over `ts + METHOD + path-with-query + body` and sent under
 * `AbortSignal.timeout`, matching `twilio-verify.connector.ts` and `http-request.connector.ts`:
 * `fetch`, no provider SDK. Status handling lives here too, so the adapter reads meaning
 * (an existing applicant id, a named-incomplete error, an absent AML case) rather than raw codes.
 */
@Injectable()
export class SumsubClient {
  private readonly logger = new Logger(SumsubClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.baseUrl = configService.getOrThrow<string>('SUMSUB_BASE_URL');
    this.timeoutMs = configService.getOrThrow<number>('SUMSUB_TIMEOUT_MS');
  }

  /** `GET /resources/applicants/-/levels` — the `-` is literal, not a placeholder. */
  async findLevel(
    credentials: SumsubCredentials,
    levelName: string,
  ): Promise<SumsubLevel | undefined> {
    const response = await this.signedRequest(credentials, 'GET', '/resources/applicants/-/levels');

    if (!response.ok) {
      throw new SumsubUnavailableException();
    }

    const found = this.findLevelItem(await this.readJson(response), levelName);

    if (!found) {
      return undefined;
    }

    const requiredIdDocs = found.requiredIdDocs;

    return {
      name: levelName,
      docSets: this.parseLevelDocSets(
        typeof requiredIdDocs === 'object' && requiredIdDocs !== null
          ? (requiredIdDocs as { docSets?: unknown }).docSets
          : undefined,
      ),
    };
  }

  /**
   * The levels endpoint answers `{list: {items: [...]}}`, not a bare array. A body that does not
   * carry that envelope is unparseable, not an empty tenant: reporting it as "no levels" would
   * surface every lookup as `SumsubLevelNotFoundError` and send an operator hunting for a level
   * name that is present and correct.
   */
  private findLevelItem(parsed: unknown, levelName: string): Record<string, unknown> | undefined {
    if (typeof parsed !== 'object' || parsed === null) {
      throw new SumsubUnavailableException();
    }

    const list = (parsed as { list?: unknown }).list;

    if (typeof list !== 'object' || list === null) {
      throw new SumsubUnavailableException();
    }

    const items = (list as { items?: unknown }).items;

    if (!Array.isArray(items)) {
      throw new SumsubUnavailableException();
    }

    return items.find(
      (entry): entry is Record<string, unknown> =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { name?: unknown }).name === levelName,
    );
  }

  /** A level's docSets live under `requiredIdDocs`, never directly on the level item. */
  private parseLevelDocSets(value: unknown): readonly SumsubLevelDocSet[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) =>
        typeof entry === 'object' && entry !== null
          ? (entry as { idDocSetType?: unknown }).idDocSetType
          : undefined,
      )
      .filter((idDocSetType): idDocSetType is string => typeof idDocSetType === 'string')
      .map((idDocSetType) => ({ idDocSetType }));
  }

  /**
   * `POST /resources/applicants?levelName={level}`. A `409` means the applicant already exists;
   * Sumsub names its id in the error description rather than a body field, so that is what this
   * parses and returns.
   */
  async createApplicant(
    credentials: SumsubCredentials,
    levelName: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<string> {
    const path = `/resources/applicants?levelName=${encodeURIComponent(levelName)}`;
    const response = await this.signedRequest(
      credentials,
      'POST',
      path,
      this.jsonBody(body),
      'application/json',
    );

    if (response.status === HttpStatus.CONFLICT) {
      const description = this.readDescription(await this.readJson(response));
      const existingApplicantId = description.match(EXISTING_APPLICANT_ID_PATTERN)?.[1];

      if (!existingApplicantId) {
        throw new SumsubUnavailableException();
      }

      return existingApplicantId;
    }

    if (!response.ok) {
      throw new SumsubUnavailableException();
    }

    const parsed = await this.readJson(response);
    const applicantId =
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { id?: unknown }).id === 'string'
        ? (parsed as { id: string }).id
        : undefined;

    if (!applicantId) {
      throw new SumsubUnavailableException();
    }

    return applicantId;
  }

  /**
   * `POST /resources/applicants/{applicantId}/info/idDoc`. No HTTP client exposes what it will
   * transmit for a multipart body, so the raw bytes are built here, signed exactly as sent, and
   * transmitted unchanged with a `Content-Type` boundary matching the body. The image id comes
   * back as the `X-Image-Id` response header, never a body field.
   */
  async uploadIdDoc(
    credentials: SumsubCredentials,
    request: SumsubIdDocUploadRequest,
  ): Promise<string> {
    const boundary = `----SumsubBoundary${randomUUID().replace(/-/g, '')}`;
    const body = this.buildMultipartBody(boundary, request);
    const path = `/resources/applicants/${request.applicantId}/info/idDoc`;

    const response = await this.signedRequest(
      credentials,
      'POST',
      path,
      body,
      `multipart/form-data; boundary=${boundary}`,
    );

    if (!response.ok) {
      throw new SumsubUnavailableException();
    }

    const imageId = response.headers.get('X-Image-Id');
    if (!imageId) {
      throw new SumsubUnavailableException();
    }

    return imageId;
  }

  /** `POST /resources/applicants/{applicantId}/questionnaires`. */
  async submitQuestionnaire(
    credentials: SumsubCredentials,
    applicantId: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const path = `/resources/applicants/${applicantId}/questionnaires`;
    const response = await this.signedRequest(
      credentials,
      'POST',
      path,
      this.jsonBody(body),
      'application/json',
    );

    if (!response.ok) {
      throw new SumsubUnavailableException();
    }
  }

  /**
   * `POST /resources/applicants/{applicantId}/status/pending?reason=submitted`. A `409` names the
   * still-missing docSets in its description; this surfaces them as a typed error instead of the
   * adapter re-parsing provider text.
   */
  async finalizeSubmission(credentials: SumsubCredentials, applicantId: string): Promise<void> {
    const path = `/resources/applicants/${applicantId}/status/pending?reason=submitted`;
    const response = await this.signedRequest(credentials, 'POST', path);

    if (response.status === HttpStatus.CONFLICT) {
      const description = this.readDescription(await this.readJson(response));
      const missingDocSets = SUMSUB_DOC_SET_KEYS.filter((docSet) => description.includes(docSet));

      throw new SumsubSubmissionIncompleteError(applicantId, missingDocSets);
    }

    if (!response.ok) {
      throw new SumsubUnavailableException();
    }
  }

  /**
   * `GET /resources/applicants/{applicantId}/status` — the verdict source: `reviewStatus`,
   * `reviewResult.reviewAnswer`, `reviewResult.reviewRejectType`. Distinct from `findApplicant`,
   * which reads `/one` for the verified `info` block only; the two are not consolidated.
   */
  async findApplicantStatus(
    credentials: SumsubCredentials,
    applicantId: string,
  ): Promise<SumsubApplicantStatus> {
    const path = `/resources/applicants/${applicantId}/status`;
    const response = await this.signedRequest(credentials, 'GET', path);

    if (!response.ok) {
      throw new SumsubUnavailableException();
    }

    return this.parseApplicantStatus(await this.readJson(response));
  }

  /**
   * `GET /resources/applicants/{applicantId}/one` — exists only for the verified `info` block the
   * mismatch guard compares against `fixedInfo`. Not the verdict source; see `findApplicantStatus`.
   */
  async findApplicant(
    credentials: SumsubCredentials,
    applicantId: string,
  ): Promise<SumsubApplicantInfo> {
    const path = `/resources/applicants/${applicantId}/one`;
    const response = await this.signedRequest(credentials, 'GET', path);

    if (!response.ok) {
      throw new SumsubUnavailableException();
    }

    const parsed = await this.readJson(response);
    const record =
      typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    const info = record.info;

    return typeof info === 'object' && info !== null ? (info as SumsubApplicantInfo) : {};
  }

  /** `GET /resources/applicants/{applicantId}/requiredIdDocsStatus`. */
  async findRequiredIdDocsStatus(
    credentials: SumsubCredentials,
    applicantId: string,
  ): Promise<SumsubRequiredIdDocsStatus> {
    const path = `/resources/applicants/${applicantId}/requiredIdDocsStatus`;
    const response = await this.signedRequest(credentials, 'GET', path);

    if (!response.ok) {
      throw new SumsubUnavailableException();
    }

    const parsed = await this.readJson(response);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as SumsubRequiredIdDocsStatus)
      : {};
  }

  /**
   * `GET /resources/api/applicants/{applicantId}/amlCase` — the `/resources/api/` prefix is
   * literal. A `204` means no AML case at all, returned as `undefined`, distinct from a `200`
   * with an empty `hits` array.
   */
  async findAmlCase(
    credentials: SumsubCredentials,
    applicantId: string,
  ): Promise<SumsubAmlCase | undefined> {
    const path = `/resources/api/applicants/${applicantId}/amlCase`;
    const response = await this.signedRequest(credentials, 'GET', path);

    if (response.status === HttpStatus.NO_CONTENT) {
      return undefined;
    }

    if (!response.ok) {
      throw new SumsubUnavailableException();
    }

    const parsed = await this.readJson(response);
    const record =
      typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};

    return { hits: Array.isArray(record.hits) ? record.hits : [] };
  }

  /** `POST /resources/applicants/{applicantId}/resetStep/{idDocSetType}`. */
  async resetStep(
    credentials: SumsubCredentials,
    applicantId: string,
    idDocSetType: SumsubDocSetKey,
  ): Promise<void> {
    const path = `/resources/applicants/${applicantId}/resetStep/${idDocSetType}`;
    const response = await this.signedRequest(credentials, 'POST', path);

    if (!response.ok) {
      throw new SumsubUnavailableException();
    }
  }

  private async signedRequest(
    credentials: SumsubCredentials,
    method: SumsubHttpMethod,
    path: string,
    body?: Buffer,
    contentType?: string,
  ): Promise<Response> {
    const ts = Math.floor(Date.now() / 1000).toString();
    const signature = this.sign(credentials.secretKey, ts, method, path, body);
    const headers: Record<string, string> = {
      'X-App-Token': credentials.appToken,
      'X-App-Access-Ts': ts,
      'X-App-Access-Sig': signature,
    };

    if (contentType) {
      headers['Content-Type'] = contentType;
    }

    this.logger.debug(`SUMSUB_REQUEST method=${method} path=${path}`);

    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        // `@types/node`'s `Buffer<ArrayBufferLike>` does not structurally satisfy `BodyInit`'s
        // `ArrayBufferView<ArrayBuffer>` member; a plain `Uint8Array` copy of the exact same
        // bytes does. The copy transmits identically to what was signed above.
        body: body ? new Uint8Array(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new SumsubUnavailableException();
    }
  }

  private sign(
    secretKey: string,
    ts: string,
    method: SumsubHttpMethod,
    path: string,
    body?: Buffer,
  ): string {
    const prefix = Buffer.from(`${ts}${method}${path}`, 'utf-8');
    const signedBytes = body ? Buffer.concat([prefix, body]) : prefix;

    return createHmac('sha256', secretKey).update(signedBytes).digest('hex');
  }

  private jsonBody(payload: Readonly<Record<string, unknown>>): Buffer {
    return Buffer.from(JSON.stringify(payload), 'utf-8');
  }

  private buildMultipartBody(boundary: string, request: SumsubIdDocUploadRequest): Buffer {
    const CRLF = '\r\n';
    const metadataPart = Buffer.from(
      `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="metadata"${CRLF}` +
        `Content-Type: application/json${CRLF}${CRLF}` +
        `${JSON.stringify(request.metadata)}${CRLF}`,
      'utf-8',
    );
    const contentHeader = Buffer.from(
      `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="content"; filename="${request.fileName}"${CRLF}` +
        `Content-Type: ${request.contentType}${CRLF}${CRLF}`,
      'utf-8',
    );
    const closing = Buffer.from(`${CRLF}--${boundary}--${CRLF}`, 'utf-8');

    return Buffer.concat([metadataPart, contentHeader, request.fileContent, closing]);
  }

  private async readJson(response: Response): Promise<unknown> {
    const text = await response.text();

    if (text.trim() === '') {
      return undefined;
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new SumsubUnavailableException();
    }
  }

  private readDescription(parsed: unknown): string {
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { description?: unknown }).description === 'string'
    ) {
      return (parsed as { description: string }).description;
    }

    return '';
  }

  private parseApplicantStatus(parsed: unknown): SumsubApplicantStatus {
    if (typeof parsed !== 'object' || parsed === null) {
      throw new SumsubUnavailableException();
    }

    const record = parsed as Record<string, unknown>;
    const reviewStatus = record.reviewStatus;

    if (typeof reviewStatus !== 'string') {
      throw new SumsubUnavailableException();
    }

    const reviewResultValue = record.reviewResult;
    if (typeof reviewResultValue !== 'object' || reviewResultValue === null) {
      return { reviewStatus };
    }

    const reviewResultRecord = reviewResultValue as Record<string, unknown>;

    return {
      reviewStatus,
      reviewResult: {
        reviewAnswer:
          typeof reviewResultRecord.reviewAnswer === 'string'
            ? reviewResultRecord.reviewAnswer
            : undefined,
        reviewRejectType:
          typeof reviewResultRecord.reviewRejectType === 'string'
            ? (reviewResultRecord.reviewRejectType as SumsubReviewRejectType)
            : undefined,
        moderationComment:
          typeof reviewResultRecord.moderationComment === 'string'
            ? reviewResultRecord.moderationComment
            : undefined,
        buttonIds: Array.isArray(reviewResultRecord.buttonIds)
          ? reviewResultRecord.buttonIds.filter((id): id is string => typeof id === 'string')
          : undefined,
      },
    };
  }
}
