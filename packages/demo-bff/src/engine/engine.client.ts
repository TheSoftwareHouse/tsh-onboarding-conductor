import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppConfig } from '../config/app.config';
import { EngineError } from './engine-error';

// Shapes follow packages/shared/openapi/engine.openapi.json (the engine's HTTP contract).

export type WorkflowStatus =
  'awaiting_user' | 'awaiting_manual_review' | 'approved' | 'rejected' | 'invalid';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface StartOnboardingResponse {
  onboardingId: string;
  status: WorkflowStatus;
  currentStep: string | null;
  expiresAt: null;
}

export interface StateField {
  name: string;
  type: 'text' | 'boolean' | 'date' | 'number' | 'array' | 'object' | 'file' | 'json';
  required: boolean;
  active: boolean;
  when?: unknown;
  dependsOn?: string[];
  schema?: Record<string, unknown>;
  value: JsonValue | null;
  upload?: { contentTypes: string[]; maxSizeBytes: number };
}

export interface StateStep {
  name: string;
  status: WorkflowStatus;
  canSubmit: boolean;
  fields: StateField[];
  schema: Record<string, unknown>;
}

export interface OnboardingState {
  onboardingId: string;
  workflowId: string;
  workflowVersion: number;
  status: WorkflowStatus;
  currentStep: string | null;
  terminal: boolean;
  rejectionReason: string | null;
  step: StateStep | null;
  pending: { connectorId: string; parkedAt: string | null } | null;
  data: Record<string, JsonValue>;
}

export interface SubmitOnboardingResponse {
  appliedStep: string | null;
  status: WorkflowStatus;
  currentStep: string | null;
  rejectionReason: string | null;
}

export interface ReserveDocumentRequest {
  field: string;
  contentType: string;
  sizeBytes: number;
}

export interface ReserveDocumentResponse {
  documentId: string;
  upload: { kind: 'post-form'; url: string; fields: Record<string, string> };
  expiresAt: string;
}

export interface CompleteDocumentResponse {
  documentId: string;
}

/**
 * The only place the BFF talks to the engine, and only the customer-facing routes: no admin
 * route is reachable from here. A non-2xx and any transport failure surface as `EngineError`.
 *
 * A submit is not idempotent and runs the connector chain inline, so a timeout here does not
 * mean the transition was not applied: callers re-fetch `getState`, never re-send.
 */
@Injectable()
export class EngineClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<AppConfig, true>) {
    this.baseUrl = config.get('ENGINE_BASE_URL', { infer: true }).replace(/\/+$/, '');
    this.timeoutMs = config.get('ENGINE_REQUEST_TIMEOUT_MS', { infer: true });
  }

  startOnboarding(workflowId: string): Promise<StartOnboardingResponse> {
    return this.request('POST', '/v1/onboardings', { workflowId });
  }

  getState(onboardingId: string): Promise<OnboardingState> {
    return this.request('GET', `/v1/onboardings/${encodeURIComponent(onboardingId)}/state`);
  }

  submit(onboardingId: string, values: Record<string, unknown>): Promise<SubmitOnboardingResponse> {
    return this.request(
      'POST',
      `/v1/onboardings/${encodeURIComponent(onboardingId)}/submit`,
      values,
    );
  }

  reserveDocument(
    onboardingId: string,
    reservation: ReserveDocumentRequest,
  ): Promise<ReserveDocumentResponse> {
    return this.request(
      'POST',
      `/v1/onboardings/${encodeURIComponent(onboardingId)}/documents`,
      reservation,
    );
  }

  completeDocument(onboardingId: string, documentId: string): Promise<CompleteDocumentResponse> {
    return this.request(
      'POST',
      `/v1/onboardings/${encodeURIComponent(onboardingId)}/documents/${encodeURIComponent(documentId)}/complete`,
      {},
    );
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw EngineError.transport(`${method} ${path} failed: ${describe(error)}`);
    }

    let parsed: unknown;

    try {
      const text = await response.text();
      parsed = text === '' ? undefined : JSON.parse(text);
    } catch (error) {
      if (response.ok) {
        throw EngineError.transport(`${method} ${path} returned an unreadable body`);
      }
      // A non-JSON error body still carries its status.
      parsed = undefined;
    }

    if (!response.ok) {
      throw EngineError.fromResponse(response.status, parsed);
    }

    return parsed as T;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
